namespace TEKLead.Api.Services;

/// <summary>
/// Stores uploaded attachments (e.g. brochures) on local disk, keyed by a random token.
/// Intended for short-lived use — Quick Outreach sends within minutes of upload.
/// Files are NOT cleaned up automatically on a schedule; a container restart clears the temp dir.
/// </summary>
public static class LocalAttachmentStore
{
    private static readonly string RootDir = Path.Combine(Path.GetTempPath(), "teklead-attachments");

    public static async Task<string> SaveAsync(IFormFile file)
    {
        Directory.CreateDirectory(RootDir);
        var token = Guid.NewGuid().ToString("N");
        var safeName = Path.GetFileName(file.FileName);
        var storedName = $"{token}__{safeName}";
        var fullPath = Path.Combine(RootDir, storedName);

        await using (var stream = new FileStream(fullPath, FileMode.Create))
        {
            await file.CopyToAsync(stream);
        }

        return token;
    }

    /// <summary>Resolves a token to a full file path. Returns null if not found.</summary>
    public static string? ResolvePath(string token)
    {
        if (string.IsNullOrWhiteSpace(token) || !Directory.Exists(RootDir)) return null;
        var match = Directory.GetFiles(RootDir, $"{token}__*").FirstOrDefault();
        return match;
    }

    public static string GetFileName(string fullPath) =>
        Path.GetFileName(fullPath).Split("__", 2).ElementAtOrDefault(1) ?? Path.GetFileName(fullPath);

    public static void TryDelete(string fullPath)
    {
        try { if (File.Exists(fullPath)) File.Delete(fullPath); } catch { }
    }
}
