const EXACT_BUCKET_CASE_LIMIT = 18;
const EXACT_BUCKET_WORKER_LIMIT = 8;
const EXACT_BUCKET_NODE_LIMIT = 150_000;
const EXACT_BUCKET_IMPROVEMENT_RATIO = 0.03;

function estimateForCase(testCase) {
  const estimate = Number(testCase?.estimatedMs ?? 0);
  return Number.isFinite(estimate) && estimate > 0 ? estimate : 1;
}

function makeBuckets(bucketCount) {
  return Array.from({ length: bucketCount }, (_, index) => ({
    caseIds: [],
    index,
    totalMs: 0,
  }));
}

function cloneBuckets(buckets) {
  return buckets.map((bucket) => ({
    caseIds: [...bucket.caseIds],
    index: bucket.index,
    totalMs: bucket.totalMs,
  }));
}

function sortItems(caseIdsToRun, caseRecords) {
  const casesById = new Map(caseRecords.map((testCase) => [testCase.id, testCase]));
  return [...caseIdsToRun]
    .map((caseId) => ({
      caseId,
      estimateMs: estimateForCase(casesById.get(caseId)),
    }))
    .sort((left, right) => right.estimateMs - left.estimateMs || left.caseId.localeCompare(right.caseId));
}

function greedyBuckets(items, bucketCount) {
  const buckets = makeBuckets(bucketCount);
  for (const item of items) {
    const bucket = buckets
      .slice()
      .sort((left, right) => left.totalMs - right.totalMs || left.index - right.index)[0];
    bucket.caseIds.push(item.caseId);
    bucket.totalMs += item.estimateMs;
  }
  return buckets;
}

function optimizeBucketsExactly(items, bucketCount, initialBuckets) {
  if (
    items.length > EXACT_BUCKET_CASE_LIMIT
    || bucketCount > EXACT_BUCKET_WORKER_LIMIT
    || bucketCount <= 1
  ) {
    return initialBuckets;
  }

  const remainingSuffixMs = Array.from({ length: items.length + 1 }, () => 0);
  for (let index = items.length - 1; index >= 0; index -= 1) {
    remainingSuffixMs[index] = remainingSuffixMs[index + 1] + items[index].estimateMs;
  }

  const buckets = makeBuckets(bucketCount);
  let bestBuckets = cloneBuckets(initialBuckets);
  const initialBestTotalMs = Math.max(...initialBuckets.map((bucket) => bucket.totalMs));
  let bestTotalMs = initialBestTotalMs;
  let visitedNodes = 0;

  function currentTotalMs() {
    return buckets.reduce((sum, bucket) => sum + bucket.totalMs, 0);
  }

  function lowerBound(index) {
    return Math.max(
      ...buckets.map((bucket) => bucket.totalMs),
      Math.ceil((currentTotalMs() + remainingSuffixMs[index]) / bucketCount),
    );
  }

  function search(index) {
    visitedNodes += 1;
    if (visitedNodes > EXACT_BUCKET_NODE_LIMIT) {
      return;
    }
    if (lowerBound(index) > bestTotalMs) {
      return;
    }
    if (index >= items.length) {
      const maxTotalMs = Math.max(...buckets.map((bucket) => bucket.totalMs));
      if (maxTotalMs <= bestTotalMs) {
        bestTotalMs = maxTotalMs;
        bestBuckets = cloneBuckets(buckets);
      }
      return;
    }

    const item = items[index];
    const seenBucketTotals = new Set();
    const candidateBuckets = buckets
      .slice()
      .sort((left, right) => left.totalMs - right.totalMs || left.index - right.index);
    let visitedEmptyBucket = false;

    for (const bucket of candidateBuckets) {
      if (seenBucketTotals.has(bucket.totalMs)) {
        continue;
      }
      seenBucketTotals.add(bucket.totalMs);
      const wasEmpty = bucket.totalMs === 0;
      const projectedTotalMs = bucket.totalMs + item.estimateMs;
      if (projectedTotalMs > bestTotalMs) {
        continue;
      }

      bucket.caseIds.push(item.caseId);
      bucket.totalMs = projectedTotalMs;
      search(index + 1);
      bucket.totalMs -= item.estimateMs;
      bucket.caseIds.pop();

      // Empty buckets are symmetric; one empty placement is enough.
      if (wasEmpty) {
        visitedEmptyBucket = true;
      }
    }
    if (visitedEmptyBucket) {
      return;
    }
  }

  search(0);
  const bestExactTotalMs = Math.max(...bestBuckets.map((bucket) => bucket.totalMs));
  if (bestExactTotalMs >= initialBestTotalMs * (1 - EXACT_BUCKET_IMPROVEMENT_RATIO)) {
    return initialBuckets;
  }
  return bestBuckets;
}

export function planCaseBuckets(caseIdsToRun, workers, caseRecords) {
  const bucketCount = Math.min(workers, caseIdsToRun.length);
  const items = sortItems(caseIdsToRun, caseRecords);
  const initialBuckets = greedyBuckets(items, bucketCount);
  return optimizeBucketsExactly(items, bucketCount, initialBuckets)
    .filter((bucket) => bucket.caseIds.length > 0)
    .sort((left, right) => left.index - right.index);
}
