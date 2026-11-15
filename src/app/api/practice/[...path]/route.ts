import { NextRequest, NextResponse } from "next/server";
import { requirePracticeSession } from "@/lib/practice-auth";
import { practiceRequest } from "@/lib/practice-service";
import { PracticeError } from "@/lib/practice-store";
import { isSameRequestOrigin } from "@/lib/request-origin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    if (
      req.method !== "GET" &&
      (!isSameRequestOrigin(
        req.headers.get("origin"),
        req.headers.get("host"),
        req.nextUrl.protocol,
      ) ||
        req.headers.get("sec-fetch-site") === "cross-site")
    )
      throw new PracticeError(403, "Cross-origin requests are not allowed.");
    const actor = await requirePracticeSession(req);
    return await practiceRequest(req, actor, (await context.params).path);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof PracticeError
            ? error.message
            : "Practice service unavailable.",
      },
      {
        status: error instanceof PracticeError ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
