#!/usr/bin/env node
interface ProjectIdentity {
    projectPath: string;
    pathBirthtimeMs: number;
    projectId: string;
}

type SkipReasonBucket = 'large_file' | 'binary_file' | 'ignored_json' | 'no_indexable_chunks' | 'processing_error';

/**
 * 扫描结果统计
 */
interface ScanStats {
    totalFiles: number;
    added: number;
    modified: number;
    unchanged: number;
    deleted: number;
    skipped: number;
    errors: number;
    skippedByReason: Partial<Record<SkipReasonBucket, number>>;
    visibility: {
        candidateFiles: number;
        processedFiles: number;
        embeddingFiles: number;
        selfHealFiles: number;
        deletedPaths: number;
    };
    /** 向量索引统计 */
    vectorIndex?: {
        indexed: number;
        deleted: number;
        errors: number;
    };
}
/**
 * 进度回调函数类型
 *
 * @param current 当前进度值
 * @param total 总进度值（可选，未知时为 undefined）
 * @param message 人可读的进度消息（可选）
 */
type ProgressCallback = (current: number, total?: number, message?: string) => void;
/**
 * 扫描选项
 */
interface ScanOptions {
    /** 强制重新扫描所有文件 */
    force?: boolean;
    /** 是否进行向量索引（默认 true） */
    vectorIndex?: boolean;
    /** 进度回调 */
    onProgress?: ProgressCallback;
    /** 预先计算好的待扫描文件绝对路径 */
    precomputedFilePaths?: string[];
}

declare function runIndexCommand(options: {
    rootPath: string;
    force?: boolean;
    yes?: boolean;
    isInteractive?: boolean;
    confirmIndex?: () => Promise<boolean>;
    logLine?: (line: string) => void;
    scanFn?: (rootPath: string, options: ScanOptions) => Promise<ScanStats>;
    recordIndexedProjectFn?: (rootPath: string, options?: {
        confirmedAt?: string | null;
    }) => Promise<void>;
    identity?: ProjectIdentity;
}): Promise<ScanStats>;

declare function normalizeCliArgs(argv: string[]): string[];
declare function runIndexCliCommand(options: {
    rootPath: string;
    force?: boolean;
    yes?: boolean;
    isInteractive?: boolean;
    runIndexCommandFn?: typeof runIndexCommand;
    logger?: {
        info: (message: string) => void;
        error: (message: string) => void;
    };
    exit?: (code: number) => void;
}): Promise<void>;
declare function runCli(argv?: string[], invokedPath?: string): void;

export { normalizeCliArgs, runCli, runIndexCliCommand };
