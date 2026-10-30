namespace TEKLead.Api.Services;

/// <summary>
/// Stores uploaded documents on a persistent disk (Railway volume).
/// Root = FILE_STORAGE_PATH env var, else RAILWAY_VOLUME_MOUNT_PATH/uploads, else /data/uploads.
/// Files are addressed by a relative key like "proposals/{id}/{guid}__{name}" and served via /api/files/{key}.
/// </summary>
public class FileStorageService
{
    public const string UrlPrefix = "/api/files/";

    private readonly ILogger<FileStorageService> _log;
    public string Root { get; }

    public FileStorageService(ILogger<FileStorageService> log)
    {
        _log = log;
        var env = Environment.GetEnvironmentVariable("FILE_STORAGE_PATH");
        var vol = Environment.GetEnvironmentVariable("RAILWAY_VOLUME_MOUNT_PATH");
        Root = !string.IsNullOrWhiteSpace(env) ? env
             : !string.IsNullOrWhiteSpace(vol) ? Path.Combine(vol, "uploads")
             : "/data/uploads";
        Root = Path.GetFullPath(Root);
    }

    public async Task<string> SaveAsync(Stream data, string folder, string fileName)
    {
        var safeName = SanitizeFileName(fileName);
        var safeFolder = string.Join('/', folder.Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Select(SanitizeFileName));
        var key = $"{safeFolder}/{Guid.NewGuid():N}__{safeName}";
        var fullPath = ResolveFullPath(key) ?? throw new InvalidOperationException("Invalid storage path.");

        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        await using (var fs = new FileStream(fullPath, FileMode.CreateNew, FileAccess.Write))
        {
            await data.CopyToAsync(fs);
        }
        _log.LogInformation("Stored file: {Key}", key);
        return UrlPrefix + key;
    }

    /// <summary>Maps a key (or a /api/files/... url) to an absolute path inside Root. Null if outside Root.</summary>
    public string? ResolveFullPath(string keyOrUrl)
    {
        if (string.IsNullOrWhiteSpace(keyOrUrl)) return null;
        var key = keyOrUrl;
        var idx = key.IndexOf(UrlPrefix, StringComparison.OrdinalIgnoreCase);
        if (idx >= 0) key = key[(idx + UrlPrefix.Length)..];
        key = Uri.UnescapeDataString(key).Replace('\\', '/').TrimStart('/');

        var full = Path.GetFullPath(Path.Combine(Root, key));
        var rootWithSep = Root.EndsWith(Path.DirectorySeparatorChar) ? Root : Root + Path.DirectorySeparatorChar;
        return full.StartsWith(rootWithSep, StringComparison.Ordinal) ? full : null;
    }

    public bool IsLocalUrl(string? url) =>
        !string.IsNullOrWhiteSpace(url) && url.Contains(UrlPrefix, StringComparison.OrdinalIgnoreCase);

    public void TryDelete(string url)
    {
        try
        {
            var p = ResolveFullPath(url);
            if (p != null && File.Exists(p)) File.Delete(p);
        }
        catch (Exception ex) { _log.LogWarning(ex, "Delete failed for {Url}", url); }
    }

    public static string DisplayName(string fullPath)
    {
        var name = Path.GetFileName(fullPath);
        var parts = name.Split("__", 2);
        return parts.Length == 2 ? parts[1] : name;
    }

    private static string SanitizeFileName(string name)
    {
        name = Path.GetFileName(name ?? "");
        foreach (var c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '_');
        name = name.Replace("..", "_").Trim();
        if (string.IsNullOrEmpty(name)) name = "file";
        return name.Length > 120 ? name[^120..] : name;
    }
}
