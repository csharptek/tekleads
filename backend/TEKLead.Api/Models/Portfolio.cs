namespace TEKLead.Api.Models;

public class PortfolioProject
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Title { get; set; } = "";
    public string Industry { get; set; } = "";
    public string[] Tags { get; set; } = Array.Empty<string>();
    public string Problem { get; set; } = "";
    public string Solution { get; set; } = "";
    public string TechStack { get; set; } = "";
    public string Outcomes { get; set; } = "";
    public string Links { get; set; } = "";
    public bool EmbeddingIndexed { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
