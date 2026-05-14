namespace TEKLead.Api.Models;

public class Product
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string Tagline { get; set; } = "";
    public string TargetIndustry { get; set; } = "";
    public string TargetRole { get; set; } = "";
    public string ProblemSolved { get; set; } = "";
    public string Deliverables { get; set; } = "";
    public string Excludes { get; set; } = "";
    public string Timeline { get; set; } = "";
    public string Price { get; set; } = "";
    public string[] Tags { get; set; } = Array.Empty<string>();
    public string ProductType { get; set; } = "core"; // core | addon
    public string Status { get; set; } = "active"; // active | disabled | draft
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class GenerateProductsRequest
{
    public string[] Keywords { get; set; } = Array.Empty<string>();
}

public class RefineProductRequest
{
    public Product Product { get; set; } = new();
    public string Prompt { get; set; } = "";
}
