using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/blob")]
public class BlobController : ControllerBase
{
    private readonly BlobService _blob;

    public BlobController(BlobService blob) => _blob = blob;

    [HttpPost("upload")]
    [RequestSizeLimit(20 * 1024 * 1024)]
    public async Task<IActionResult> Upload(IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { error = "No file provided" });

        var allowed = new[]
        {
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "image/jpeg", "image/png", "image/gif", "image/webp",
            "video/mp4", "video/3gpp",
            "audio/mpeg", "audio/ogg", "audio/aac", "audio/mp4"
        };
        if (!allowed.Contains(file.ContentType))
            return BadRequest(new { error = $"File type not allowed: {file.ContentType}" });

        await using var stream = file.OpenReadStream();
        var url = await _blob.UploadPublicAsync(stream, file.FileName, file.ContentType);
        return Ok(new { url, name = file.FileName, contentType = file.ContentType });
    }
}
