using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/files")]
public class FilesController : ControllerBase
{
    private readonly FileStorageService _files;
    private static readonly FileExtensionContentTypeProvider _types = new();

    public FilesController(FileStorageService files) => _files = files;

    [HttpGet("{**key}")]
    public IActionResult Get(string key)
    {
        var path = _files.ResolveFullPath(key);
        if (path == null || !System.IO.File.Exists(path)) return NotFound(new { error = "File not found" });

        var name = FileStorageService.DisplayName(path);
        if (!_types.TryGetContentType(name, out var contentType)) contentType = "application/octet-stream";

        var inline = contentType.StartsWith("image/") || contentType == "application/pdf";
        var stream = System.IO.File.OpenRead(path);
        return inline
            ? File(stream, contentType, enableRangeProcessing: true)
            : File(stream, contentType, name, enableRangeProcessing: true);
    }
}
