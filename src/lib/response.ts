import { NextResponse } from 'next/server';

export function successResponse<T>(data: T, message = '操作成功', code = 200) {
  return NextResponse.json({
    success: true,
    code,
    message,
    data,
    timestamp: new Date().toISOString(),
  });
}

export function errorResponse(message: string, code = 400, details?: unknown) {
  return NextResponse.json(
    {
      success: false,
      code,
      message,
      details: details ?? null,
      timestamp: new Date().toISOString(),
    },
    { status: code }
  );
}
