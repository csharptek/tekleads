using System.Text;
using System.Text.Json;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class ProductAIService
{
    private readonly SettingsService _settings;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<ProductAIService> _log;

    public ProductAIService(SettingsService settings, IHttpClientFactory http, ILogger<ProductAIService> log)
    {
        _settings = settings;
        _http = http;
        _log = log;
    }

    // ── Generate Products from keywords + RAG ────────────────────────────────

    public async Task<List<Product>> GenerateProducts(string[] keywords)
    {
        var settings = await _settings.GetAll();

        var aoEndpoint   = settings.GetValueOrDefault(SettingKeys.AzureOpenAiEndpoint, "");
        var aoKey        = settings.GetValueOrDefault(SettingKeys.AzureOpenAiKey, "");
        var aoDeployment = settings.GetValueOrDefault(SettingKeys.AzureOpenAiDeployment, "");
        var aoEmbedDep   = settings.GetValueOrDefault(SettingKeys.AzureOpenAiEmbeddingDeployment, "text-embedding-3-small");
        var searchEp     = settings.GetValueOrDefault(SettingKeys.AzureSearchEndpoint, "");
        var searchKey    = settings.GetValueOrDefault(SettingKeys.AzureSearchKey, "");
        var searchIndex  = settings.GetValueOrDefault(SettingKeys.AzureSearchIndex, "portfolio");

        if (string.IsNullOrWhiteSpace(aoEndpoint) || string.IsNullOrWhiteSpace(aoDeployment))
            throw new Exception("Azure OpenAI not configured in Settings.");

        // RAG: search portfolio for relevant case studies
        var portfolioContext = "";
        if (!string.IsNullOrWhiteSpace(searchEp) && !string.IsNullOrWhiteSpace(aoEndpoint))
        {
            try
            {
                var query = string.Join(" ", keywords);
                var portfolioItems = await SearchPortfolio(aoEndpoint, aoKey, aoEmbedDep, searchEp, searchKey, searchIndex, query);
                portfolioContext = BuildPortfolioContext(portfolioItems);
            }
            catch (Exception ex)
            {
                _log.LogWarning("Portfolio RAG search failed: {0}", ex.Message);
            }
        }

        var keywordStr = string.Join(", ", keywords);

        var systemPrompt = @"You are a business product strategist specializing in IT and software services.
Your job is to create productised service packages based on keywords and existing portfolio case studies.
Respond ONLY with a valid JSON array. No markdown, no explanation, no preamble.";

        var userPrompt = $@"Keywords: {keywordStr}

Portfolio Case Studies (use these as evidence for what we deliver):
{(string.IsNullOrWhiteSpace(portfolioContext) ? "No portfolio data available." : portfolioContext)}

Based on the keywords and portfolio evidence above, generate 4 productised service packages.
Each product should be a fixed-scope, named, sellable offering that a software consultancy can deliver.

Return a JSON array of exactly 4 objects with these fields:
- name: short memorable product name (2-4 words)
- tagline: one-line value proposition (max 12 words)
- targetIndustry: primary industry this serves
- targetRole: decision maker title (e.g. CTO, IT Manager)
- problemSolved: 1-2 sentences describing the pain point
- deliverables: bullet list of exactly what client receives (use | as separator between items)
- excludes: what is NOT included (use | as separator)
- timeline: fixed timeline e.g. ""2 weeks"" or ""4-6 weeks""
- price: fixed price or range e.g. ""$2,500"" or ""$3,000 - $5,000""
- tags: comma-separated keywords
- productType: ""core"" or ""addon""

Example format:
[
  {{
    ""name"": ""AI Copilot Setup"",
    ""tagline"": ""Deploy Microsoft Copilot in your workflow in 2 weeks"",
    ""targetIndustry"": ""Healthcare"",
    ""targetRole"": ""CTO"",
    ""problemSolved"": ""Teams waste hours on manual tasks that AI can automate."",
    ""deliverables"": ""Copilot configured for M365|Custom prompts for your workflow|1-hour training session|Handover documentation"",
    ""excludes"": ""Custom model training|Third-party integrations not in M365"",
    ""timeline"": ""2 weeks"",
    ""price"": ""$2,500"",
    ""tags"": ""AI, Microsoft 365, Copilot, Automation"",
    ""productType"": ""core""
  }}
]";

        var raw = await CallAzureOpenAI(aoEndpoint, aoKey, aoDeployment, systemPrompt, userPrompt);

        return ParseProductsJson(raw);
    }

    // ── Refine a single product with a custom prompt ──────────────────────────

    public async Task<Product> RefineProduct(Product existing, string refinePrompt)
    {
        var settings = await _settings.GetAll();

        var aoEndpoint   = settings.GetValueOrDefault(SettingKeys.AzureOpenAiEndpoint, "");
        var aoKey        = settings.GetValueOrDefault(SettingKeys.AzureOpenAiKey, "");
        var aoDeployment = settings.GetValueOrDefault(SettingKeys.AzureOpenAiDeployment, "");

        if (string.IsNullOrWhiteSpace(aoEndpoint) || string.IsNullOrWhiteSpace(aoDeployment))
            throw new Exception("Azure OpenAI not configured in Settings.");

        var systemPrompt = @"You are a business product strategist. You refine productised service packages based on user instructions.
Respond ONLY with a single valid JSON object matching the product schema. No markdown, no explanation.";

        var userPrompt = $@"Existing product:
{JsonSerializer.Serialize(existing, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase })}

User instruction: {refinePrompt}

Return the updated product as a single JSON object with the same fields. Keep all fields present.
Use | as separator for deliverables and excludes lists.";

        var raw = await CallAzureOpenAI(aoEndpoint, aoKey, aoDeployment, systemPrompt, userPrompt);

        return ParseSingleProduct(raw, existing);
    }

    // ── Portfolio RAG search ──────────────────────────────────────────────────

    private async Task<List<dynamic>> SearchPortfolio(
        string aoEndpoint, string aoKey, string aoEmbedDep,
        string searchEp, string searchKey, string searchIndex, string query)
    {
        var embedding = await GenerateEmbedding(aoEndpoint, aoKey, aoEmbedDep, query);

        var client = _http.CreateClient();
        client.DefaultRequestHeaders.Add("api-key", searchKey);

        var url = $"{searchEp.TrimEnd('/')}/indexes/{searchIndex}/docs/search?api-version=2024-05-01-preview";

        var body = JsonSerializer.Serialize(new
        {
            vectorQueries = new[]
            {
                new { kind = "vector", vector = embedding, exhaustive = true, fields = "embedding", k = 5 }
            },
            select = "title,industry,problem,solution,tech_stack,outcomes",
            top = 5
        });

        var resp = await client.PostAsync(url, new StringContent(body, Encoding.UTF8, "application/json"));
        var json = await resp.Content.ReadAsStringAsync();

        if (!resp.IsSuccessStatusCode)
        {
            _log.LogWarning("Azure AI Search failed: {0}", json);
            return new List<dynamic>();
        }

        var doc = JsonDocument.Parse(json);
        var results = new List<dynamic>();

        foreach (var item in doc.RootElement.GetProperty("value").EnumerateArray())
        {
            results.Add(new
            {
                Title     = GetStr(item, "title"),
                Industry  = GetStr(item, "industry"),
                Problem   = GetStr(item, "problem"),
                Solution  = GetStr(item, "solution"),
                TechStack = GetStr(item, "tech_stack"),
                Outcomes  = GetStr(item, "outcomes"),
            });
        }

        return results;
    }

    private static string BuildPortfolioContext(List<dynamic> items)
    {
        if (items.Count == 0) return "";
        var sb = new StringBuilder();
        foreach (var item in items)
        {
            sb.AppendLine($"Project: {item.Title} | Industry: {item.Industry}");
            sb.AppendLine($"  Problem: {item.Problem}");
            sb.AppendLine($"  Solution: {item.Solution}");
            sb.AppendLine($"  Tech: {item.TechStack}");
            sb.AppendLine($"  Outcomes: {item.Outcomes}");
            sb.AppendLine();
        }
        return sb.ToString();
    }

    // ── Azure OpenAI call ─────────────────────────────────────────────────────

    private async Task<string> CallAzureOpenAI(string endpoint, string key, string deployment, string system, string user)
    {
        var client = _http.CreateClient();
        client.DefaultRequestHeaders.Add("api-key", key);
        client.Timeout = TimeSpan.FromSeconds(120);

        var url = $"{endpoint.TrimEnd('/')}/openai/deployments/{deployment}/chat/completions?api-version=2024-02-01";
        var messages = new[]
        {
            new { role = "system", content = system },
            new { role = "user",   content = user   },
        };
        var body = JsonSerializer.Serialize(new { messages, max_completion_tokens = 3000 });

        var resp = await client.PostAsync(url, new StringContent(body, Encoding.UTF8, "application/json"));
        var json = await resp.Content.ReadAsStringAsync();

        if (!resp.IsSuccessStatusCode)
            throw new Exception($"OpenAI {(int)resp.StatusCode}: {json}");

        var doc = JsonDocument.Parse(json);
        return doc.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString() ?? "";
    }

    private async Task<float[]> GenerateEmbedding(string endpoint, string key, string deployment, string text)
    {
        var client = _http.CreateClient();
        client.DefaultRequestHeaders.Add("api-key", key);

        var url = $"{endpoint.TrimEnd('/')}/openai/deployments/{deployment}/embeddings?api-version=2024-02-01";
        var body = JsonSerializer.Serialize(new { input = text });

        var resp = await client.PostAsync(url, new StringContent(body, Encoding.UTF8, "application/json"));
        var json = await resp.Content.ReadAsStringAsync();

        if (!resp.IsSuccessStatusCode)
            throw new Exception($"OpenAI embedding error: {json}");

        var doc = JsonDocument.Parse(json);
        return doc.RootElement
            .GetProperty("data")[0]
            .GetProperty("embedding")
            .EnumerateArray()
            .Select(v => v.GetSingle())
            .ToArray();
    }

    // ── JSON parsing ──────────────────────────────────────────────────────────

    private static List<Product> ParseProductsJson(string raw)
    {
        raw = raw.Trim();
        if (raw.StartsWith("```")) raw = raw.Split('\n', 2)[1];
        if (raw.TrimEnd().EndsWith("```")) raw = raw[..raw.LastIndexOf("```")];
        raw = raw.Trim();

        var doc = JsonDocument.Parse(raw);
        var products = new List<Product>();

        foreach (var el in doc.RootElement.EnumerateArray())
        {
            products.Add(ParseProductElement(el, null));
        }

        return products;
    }

    private static Product ParseSingleProduct(string raw, Product fallback)
    {
        try
        {
            raw = raw.Trim();
            if (raw.StartsWith("```")) raw = raw.Split('\n', 2)[1];
            if (raw.TrimEnd().EndsWith("```")) raw = raw[..raw.LastIndexOf("```")];
            raw = raw.Trim();

            // Handle if AI returned array instead of object
            if (raw.StartsWith("["))
            {
                var arr = JsonDocument.Parse(raw);
                var el = arr.RootElement[0];
                return ParseProductElement(el, fallback);
            }

            var doc = JsonDocument.Parse(raw);
            return ParseProductElement(doc.RootElement, fallback);
        }
        catch
        {
            return fallback;
        }
    }

    private static Product ParseProductElement(JsonElement el, Product? fallback)
    {
        string Str(string key, string def = "") =>
            el.TryGetProperty(key, out var v) ? v.GetString() ?? def : def;

        string[] Tags(string key)
        {
            if (!el.TryGetProperty(key, out var v)) return Array.Empty<string>();
            return v.ValueKind == JsonValueKind.Array
                ? v.EnumerateArray().Select(x => x.GetString() ?? "").ToArray()
                : (v.GetString() ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        }

        return new Product
        {
            Id             = fallback?.Id ?? Guid.NewGuid(),
            Name           = Str("name"),
            Tagline        = Str("tagline"),
            TargetIndustry = Str("targetIndustry"),
            TargetRole     = Str("targetRole"),
            ProblemSolved  = Str("problemSolved"),
            Deliverables   = Str("deliverables"),
            Excludes       = Str("excludes"),
            Timeline       = Str("timeline"),
            Price          = Str("price"),
            Tags           = Tags("tags"),
            ProductType    = Str("productType", "core"),
            Status         = fallback?.Status ?? "draft",
        };
    }

    private static string GetStr(JsonElement el, string key) =>
        el.TryGetProperty(key, out var v) ? v.GetString() ?? "" : "";
}
