import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getProjectIdentity } from '../db/index.js';
import type { ContextPack, SearchConfig, Segment } from '../search/types.js';
import { logger } from '../utils/logger.js';

export interface SearchSummary {
  query: string;
  seedCount: number;
  expandedCount: number;
  fileCount: number;
  totalSegments: number;
}

export interface SearchResultSegment {
  startLine: number;
  endLine: number;
  score: number;
  language: string;
  breadcrumb: string;
  text: string;
}

export interface SearchResultFile {
  path: string;
  segments: SearchResultSegment[];
}

export interface SearchResult {
  summary: SearchSummary;
  files: SearchResultFile[];
}

export interface RetrievalInput {
  repoPath: string;
  informationRequest: string;
  technicalTerms?: string[];
}

export type SearchOutputFormat = 'text' | 'json';

const BASE_DIR = path.join(os.homedir(), '.contextweaver');
const INDEX_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_INDEX_FRESHNESS_WINDOW_MS = 20 * 60 * 1000;
const INDEX_REGISTRY_PATH = path.join(BASE_DIR, 'indexes.json');
const DEFAULT_IMPORT_ADAPTIVE_MIN_SEGMENTS = 3;
const DEFAULT_IMPORT_ADAPTIVE_MIN_TOP_SCORE = 0.55;
const DEFAULT_IMPORT_ADAPTIVE_FILES_PER_SEED = 2;
const DEFAULT_IMPORT_ADAPTIVE_CHUNKS_PER_FILE = 1;

interface ImportAdaptiveConfig {
  enabled: boolean;
  minSegments: number;
  minTopScore: number;
  importFilesPerSeed: number;
  chunksPerImportFile: number;
}

function parsePositiveIntEnv(value: string | undefined): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseNonNegativeFloatEnv(value: string | undefined): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseBooleanEnv(value: string | undefined): boolean | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return null;
}

function resolveIndexFreshnessWindowMs(): number {
  const configured =
    parsePositiveIntEnv(process.env.GROBOT_CONTEXTWEAVER_INDEX_FRESHNESS_WINDOW_MS)
    ?? parsePositiveIntEnv(process.env.CONTEXTWEAVER_INDEX_FRESHNESS_WINDOW_MS);
  if (configured === null) {
    return DEFAULT_INDEX_FRESHNESS_WINDOW_MS;
  }
  return configured;
}

function resolveImportAdaptiveConfig(): ImportAdaptiveConfig {
  const enabled = parseBooleanEnv(process.env.GROBOT_CONTEXTWEAVER_IMPORT_ADAPTIVE)
    ?? parseBooleanEnv(process.env.CONTEXTWEAVER_IMPORT_ADAPTIVE)
    ?? false;

  const minSegments = parsePositiveIntEnv(process.env.GROBOT_CONTEXTWEAVER_IMPORT_ADAPTIVE_MIN_SEGMENTS)
    ?? parsePositiveIntEnv(process.env.CONTEXTWEAVER_IMPORT_ADAPTIVE_MIN_SEGMENTS)
    ?? DEFAULT_IMPORT_ADAPTIVE_MIN_SEGMENTS;

  const minTopScore = parseNonNegativeFloatEnv(process.env.GROBOT_CONTEXTWEAVER_IMPORT_ADAPTIVE_MIN_TOP_SCORE)
    ?? parseNonNegativeFloatEnv(process.env.CONTEXTWEAVER_IMPORT_ADAPTIVE_MIN_TOP_SCORE)
    ?? DEFAULT_IMPORT_ADAPTIVE_MIN_TOP_SCORE;

  const importFilesPerSeed = parsePositiveIntEnv(process.env.GROBOT_CONTEXTWEAVER_IMPORT_ADAPTIVE_FILES_PER_SEED)
    ?? parsePositiveIntEnv(process.env.CONTEXTWEAVER_IMPORT_ADAPTIVE_FILES_PER_SEED)
    ?? DEFAULT_IMPORT_ADAPTIVE_FILES_PER_SEED;

  const chunksPerImportFile = parsePositiveIntEnv(process.env.GROBOT_CONTEXTWEAVER_IMPORT_ADAPTIVE_CHUNKS_PER_FILE)
    ?? parsePositiveIntEnv(process.env.CONTEXTWEAVER_IMPORT_ADAPTIVE_CHUNKS_PER_FILE)
    ?? DEFAULT_IMPORT_ADAPTIVE_CHUNKS_PER_FILE;

  return {
    enabled,
    minSegments,
    minTopScore,
    importFilesPerSeed,
    chunksPerImportFile,
  };
}

function topScoreOf(result: SearchResult): number {
  let top = 0;
  for (const file of result.files) {
    for (const segment of file.segments) {
      if (segment.score > top) {
        top = segment.score;
      }
    }
  }
  return top;
}

function shouldRunImportAdaptiveRetry(result: SearchResult, config: ImportAdaptiveConfig): boolean {
  if (result.summary.totalSegments <= 0) {
    return true;
  }
  if (result.summary.totalSegments < config.minSegments) {
    return true;
  }
  return topScoreOf(result) < config.minTopScore;
}

function pickPreferredSearchResult(primary: SearchResult, expanded: SearchResult): SearchResult {
  if (expanded.summary.totalSegments <= 0) {
    return primary;
  }
  const primaryTopScore = topScoreOf(primary);
  const expandedTopScore = topScoreOf(expanded);
  if (expandedTopScore > primaryTopScore + 1e-6) {
    return expanded;
  }
  if (Math.abs(expandedTopScore - primaryTopScore) <= 1e-6
    && expanded.summary.totalSegments >= primary.summary.totalSegments) {
    return expanded;
  }
  if (expanded.summary.totalSegments >= primary.summary.totalSegments + 2
    && expandedTopScore >= primaryTopScore * 0.9) {
    return expanded;
  }
  return primary;
}

async function runSearchWithConfig(input: {
  projectId: string;
  repoPath: string;
  query: string;
  configOverride?: Partial<SearchConfig>;
}): Promise<SearchResult> {
  const { SearchService } = await import('../search/SearchService.js');
  const service = new SearchService(input.projectId, input.repoPath, input.configOverride);
  await service.init();
  const pack = await service.buildContextPack(input.query);
  return buildSearchResult(pack);
}

function resolveProjectIndexAgeMs(projectId: string): number | null {
  let raw = '';
  try {
    raw = fs.readFileSync(INDEX_REGISTRY_PATH, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const indexes = (parsed as { indexes?: unknown }).indexes;
  if (!Array.isArray(indexes)) {
    return null;
  }
  const matched = indexes.find((item) => (
    typeof item === 'object'
    && item !== null
    && !Array.isArray(item)
    && (item as { projectId?: unknown }).projectId === projectId
  ));
  if (!matched) {
    return null;
  }
  const record = matched as { lastIndexedAt?: unknown; confirmedAt?: unknown };
  if (typeof record.confirmedAt !== 'string' || !record.confirmedAt.trim()) {
    return null;
  }
  if (typeof record.lastIndexedAt !== 'string' || !record.lastIndexedAt.trim()) {
    return null;
  }
  const lastIndexedAtMs = Date.parse(record.lastIndexedAt);
  if (!Number.isFinite(lastIndexedAtMs)) {
    return null;
  }
  const ageMs = Date.now() - lastIndexedAtMs;
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return null;
  }
  return ageMs;
}

async function ensureDefaultEnvFile(): Promise<void> {
  const configDir = BASE_DIR;
  const envFile = path.join(configDir, '.env');

  if (fs.existsSync(envFile)) {
    return;
  }

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    logger.info({ configDir }, '创建配置目录');
  }

  const defaultEnvContent = `# ContextWeaver 示例环境变量配置文件

# Embedding API 配置（必需）
EMBEDDINGS_API_KEY=your-api-key-here
EMBEDDINGS_BASE_URL=https://api.siliconflow.cn/v1/embeddings
EMBEDDINGS_MODEL=BAAI/bge-m3
EMBEDDINGS_MAX_CONCURRENCY=10
EMBEDDINGS_DIMENSIONS=1024
EMBEDDINGS_MAX_INPUT_TOKENS=8192

# Reranker 配置（必需）
RERANK_API_KEY=your-api-key-here
RERANK_BASE_URL=https://api.siliconflow.cn/v1/rerank
RERANK_MODEL=BAAI/bge-reranker-v2-m3
RERANK_TOP_N=20
`;

  fs.writeFileSync(envFile, defaultEnvContent);
  logger.info({ envFile }, '已创建默认 .env 配置文件');
}

function isProjectIndexed(projectId: string): boolean {
  const dbPath = path.join(BASE_DIR, projectId, 'index.db');
  return fs.existsSync(dbPath);
}

async function ensureIndexed(
  repoPath: string,
  projectId: string,
  onProgress?: (current: number, total?: number, message?: string) => void,
): Promise<void> {
  const { withLock } = await import('../utils/lock.js');
  const { scan } = await import('../scanner/index.js');

  await withLock(
    projectId,
    'index',
    async () => {
      const wasIndexed = isProjectIndexed(projectId);
      const freshnessWindowMs = resolveIndexFreshnessWindowMs();
      if (wasIndexed && freshnessWindowMs > 0) {
        const indexAgeMs = resolveProjectIndexAgeMs(projectId);
        if (indexAgeMs !== null && indexAgeMs <= freshnessWindowMs) {
          logger.info(
            {
              projectId: projectId.slice(0, 10),
              freshnessWindowMs,
              indexAgeMs,
            },
            '索引仍在新鲜窗口内，跳过扫描',
          );
          onProgress?.(100, 100, '索引命中新鲜窗口，跳过扫描');
          return;
        }
      }

      if (!wasIndexed) {
        logger.info(
          { repoPath, projectId: projectId.slice(0, 10) },
          '代码库未初始化，开始首次索引...',
        );
        onProgress?.(0, 100, '代码库未索引，开始首次索引...');
      }

      const startTime = Date.now();
      const stats = await scan(repoPath, { vectorIndex: true, onProgress });
      const elapsed = Date.now() - startTime;

      logger.info(
        {
          projectId: projectId.slice(0, 10),
          isFirstTime: !wasIndexed,
          totalFiles: stats.totalFiles,
          added: stats.added,
          modified: stats.modified,
          deleted: stats.deleted,
          vectorIndex: stats.vectorIndex,
          elapsedMs: elapsed,
        },
        '索引完成',
      );
    },
    INDEX_LOCK_TIMEOUT_MS,
  );
}

export function buildSearchResult(pack: ContextPack): SearchResult {
  return {
    summary: {
      query: pack.query,
      seedCount: pack.seeds.length,
      expandedCount: pack.expanded.length,
      fileCount: pack.files.length,
      totalSegments: pack.files.reduce((acc, file) => acc + file.segments.length, 0),
    },
    files: pack.files.map((file) => ({
      path: file.filePath,
      segments: file.segments.map((segment) => buildSearchResultSegment(segment)),
    })),
  };
}

function buildSearchResultSegment(segment: Segment): SearchResultSegment {
  return {
    startLine: segment.startLine,
    endLine: segment.endLine,
    score: segment.score,
    language: detectSegmentLanguage(segment.filePath),
    breadcrumb: segment.breadcrumb,
    text: segment.text,
  };
}

export function renderSearchResult(result: SearchResult, format: SearchOutputFormat): string {
  if (format === 'json') {
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  const fileBlocks = result.files
    .map((file) =>
      file.segments
        .map((segment) => {
          const header = `## ${file.path} (L${segment.startLine}-${segment.endLine})`;
          const breadcrumb = segment.breadcrumb ? `> ${segment.breadcrumb}` : '';
          const code = `\`\`\`${segment.language}\n${segment.text}\n\`\`\``;
          return [header, breadcrumb, code].filter(Boolean).join('\n');
        })
        .join('\n\n'),
    )
    .join('\n\n---\n\n');

  const summary = [
    `Found ${result.summary.seedCount} relevant code blocks`,
    `Files: ${result.summary.fileCount}`,
    `Total segments: ${result.summary.totalSegments}`,
  ].join(' | ');

  return `${summary}\n\n${fileBlocks}\n`;
}

export async function retrieveCodeContext(
  input: RetrievalInput,
  options?: {
    onProgress?: (current: number, total?: number, message?: string) => void;
    configOverride?: Partial<SearchConfig>;
  },
): Promise<SearchResult> {
  const { checkEmbeddingEnv, checkRerankerEnv } = await import('../config.js');
  const embeddingCheck = checkEmbeddingEnv();
  const rerankerCheck = checkRerankerEnv();
  const allMissingVars = [...embeddingCheck.missingVars, ...rerankerCheck.missingVars];

  if (allMissingVars.length > 0) {
    await ensureDefaultEnvFile();
    throw new Error(`ContextWeaver 环境变量未配置: ${allMissingVars.join(', ')}`);
  }

  const projectId = getProjectIdentity(input.repoPath).projectId;
  await ensureIndexed(input.repoPath, projectId, options?.onProgress);

  const query = [input.informationRequest, ...(input.technicalTerms || [])]
    .filter(Boolean)
    .join(' ');

  const primary = await runSearchWithConfig({
    projectId,
    repoPath: input.repoPath,
    query,
    configOverride: options?.configOverride,
  });

  const adaptiveConfig = resolveImportAdaptiveConfig();
  const hasExplicitImportOverride = typeof options?.configOverride?.importFilesPerSeed === 'number'
    || typeof options?.configOverride?.chunksPerImportFile === 'number';
  if (!adaptiveConfig.enabled || hasExplicitImportOverride) {
    return primary;
  }
  if (!shouldRunImportAdaptiveRetry(primary, adaptiveConfig)) {
    return primary;
  }

  const expandedConfigOverride: Partial<SearchConfig> = {
    ...options?.configOverride,
    importFilesPerSeed: adaptiveConfig.importFilesPerSeed,
    chunksPerImportFile: adaptiveConfig.chunksPerImportFile,
  };
  try {
    logger.info(
      {
        projectId: projectId.slice(0, 10),
        minSegments: adaptiveConfig.minSegments,
        minTopScore: adaptiveConfig.minTopScore,
        importFilesPerSeed: adaptiveConfig.importFilesPerSeed,
        chunksPerImportFile: adaptiveConfig.chunksPerImportFile,
      },
      '命中低召回阈值，触发 import 自适应二次检索',
    );
    const expanded = await runSearchWithConfig({
      projectId,
      repoPath: input.repoPath,
      query,
      configOverride: expandedConfigOverride,
    });
    return pickPreferredSearchResult(primary, expanded);
  } catch (error) {
    logger.warn(
      {
        projectId: projectId.slice(0, 10),
        message: error instanceof Error ? error.message : String(error),
      },
      'import 自适应二次检索失败，回退主检索结果',
    );
    return primary;
  }
}

function detectSegmentLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    sql: 'sql',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    md: 'markdown',
    toml: 'toml',
  };
  return langMap[ext] || ext || 'plaintext';
}
