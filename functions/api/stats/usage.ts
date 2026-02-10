function getCurrentBucket(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const driveid = url.hostname.replace(/\..*/, "");
  return env[driveid] || env["BUCKET"];
}

function getCycleStart(now: Date, cycleDay: number): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();

  const normalizedDay = Math.min(Math.max(cycleDay, 1), 28);

  if (day >= normalizedDay) {
    return new Date(Date.UTC(year, month, normalizedDay, 0, 0, 0));
  }

  return new Date(Date.UTC(year, month - 1, normalizedDay, 0, 0, 0));
}

export async function onRequestGet(context) {
  try {
    const bucket = getCurrentBucket(context);
    if (!bucket) return new Response("Not found", { status: 404 });

    const quotaBytes =
      Number(context.env.R2_QUOTA_BYTES || 0) || 10 * 1024 * 1024 * 1024;
    const cycleDay = Number(context.env.BILLING_CYCLE_DAY || 1) || 1;

    const now = new Date();
    const cycleStart = getCycleStart(now, cycleDay);

    let totalBytes = 0;
    let totalObjects = 0;
    let cycleUploadBytes = 0;
    let cycleUploadCount = 0;
    let thumbnailsBytes = 0;

    let cursor: string | undefined = undefined;

    while (true) {
      const listed = await bucket.list({ cursor, limit: 1000 });
      for (const obj of listed.objects) {
        totalBytes += obj.size;
        totalObjects += 1;

        if (obj.key.startsWith("_$flaredrive$/thumbnails/")) {
          thumbnailsBytes += obj.size;
        }

        if (new Date(obj.uploaded) >= cycleStart) {
          cycleUploadBytes += obj.size;
          cycleUploadCount += 1;
        }
      }

      if (!listed.truncated) break;
      cursor = listed.cursor;
      if (!cursor) break;
    }

    const payload = {
      now: now.toISOString(),
      cycleStartDate: cycleStart.toISOString().slice(0, 10),
      quotaBytes,
      totalBytes,
      totalObjects,
      cycleUploadBytes,
      cycleUploadCount,
      thumbnailsBytes,
      usagePercent: quotaBytes ? (totalBytes / quotaBytes) * 100 : 0,
    };

    return new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "max-age=120",
      },
    });
  } catch (e) {
    return new Response(e?.toString?.() || "unknown error", { status: 500 });
  }
}
