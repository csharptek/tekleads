namespace TEKLead.Api.Models;

public class ApiLog
{
    public long Id { get; set; }
    public string Method { get; set; } = "";
    public string Path { get; set; } = "";
    public string? QueryString { get; set; }
    public string? RequestBody { get; set; }
    public int StatusCode { get; set; }
    public string? ResponseBody { get; set; }
    public long DurationMs { get; set; }
    public string? Error { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
