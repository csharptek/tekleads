using System.Diagnostics;
using System.Text;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Middleware;

public class RequestLoggingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly IServiceScopeFactory _scopeFactory;

    private static readonly HashSet<string> _skip = new(StringComparer.OrdinalIgnoreCase)
    {
        "/", "/health", "/favicon.ico"
    };

    private const int MaxBodyBytes = 32 * 1024;

    public RequestLoggingMiddleware(RequestDelegate next, IServiceScopeFactory scopeFactory)
    {
        _next = next;
        _scopeFactory = scopeFactory;
    }

    public async Task InvokeAsync(HttpContext ctx)
    {
        var path = ctx.Request.Path.Value ?? "/";

        if (_skip.Contains(path) || path.StartsWith("/swagger", StringComparison.OrdinalIgnoreCase))
        {
            await _next(ctx);
            return;
        }

        var sw = Stopwatch.StartNew();
        var entry = new ApiLog
        {
            Method = ctx.Request.Method,
            Path = path,
            QueryString = ctx.Request.QueryString.HasValue ? ctx.Request.QueryString.Value : null,
            CreatedAt = DateTime.UtcNow,
        };

        // Buffer request body
        ctx.Request.EnableBuffering();
        try
        {
            using var reader = new StreamReader(ctx.Request.Body, Encoding.UTF8, leaveOpen: true);
            var reqBody = await reader.ReadToEndAsync();
            ctx.Request.Body.Position = 0;
            if (!string.IsNullOrWhiteSpace(reqBody))
                entry.RequestBody = reqBody.Length > MaxBodyBytes ? reqBody[..MaxBodyBytes] + "…[truncated]" : reqBody;
        }
        catch { }

        // Buffer response body
        var originalBody = ctx.Response.Body;
        using var ms = new MemoryStream();
        ctx.Response.Body = ms;

        try
        {
            await _next(ctx);
        }
        catch (Exception ex)
        {
            entry.Error = ex.Message;
            entry.StatusCode = 500;
            sw.Stop();
            entry.DurationMs = sw.ElapsedMilliseconds;
            _ = SaveLog(entry);
            ctx.Response.Body = originalBody;
            throw;
        }

        sw.Stop();
        entry.StatusCode = ctx.Response.StatusCode;
        entry.DurationMs = sw.ElapsedMilliseconds;

        ms.Position = 0;
        var respBody = await new StreamReader(ms).ReadToEndAsync();
        ms.Position = 0;
        await ms.CopyToAsync(originalBody);
        ctx.Response.Body = originalBody;

        if (!string.IsNullOrWhiteSpace(respBody))
        {
            var ct = ctx.Response.ContentType ?? "";
            if (ct.Contains("json", StringComparison.OrdinalIgnoreCase))
                entry.ResponseBody = respBody.Length > MaxBodyBytes ? respBody[..MaxBodyBytes] + "…[truncated]" : respBody;
        }

        _ = SaveLog(entry);
    }

    private async Task SaveLog(ApiLog entry)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var logSvc = scope.ServiceProvider.GetRequiredService<LogService>();
            await logSvc.InsertAsync(entry);
        }
        catch { }
    }
}

public static class RequestLoggingMiddlewareExtensions
{
    public static IApplicationBuilder UseRequestLogging(this IApplicationBuilder app)
        => app.UseMiddleware<RequestLoggingMiddleware>();
}
