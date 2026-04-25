using System.Text;
using System.Text.Json;
using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class PortfolioService
{
    private readonly SettingsService _settings;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<PortfolioService> _log;

    public PortfolioService(SettingsService settings, IHttpClientFactory http, ILogger<PortfolioService> log)
    {
        _settings = settings;
        _http = http;
        _log = log;
    }

    // ── Schema ────────────────────────────────────────────────────────────────

    public async Task EnsureSchema()
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs)) return;

        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS portfolio_projects (
                id UUID PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                industry TEXT NOT NULL DEFAULT '',
                tags TEXT[] NOT NULL DEFAULT '{}',
                problem TEXT NOT NULL DEFAULT '',
                solution TEXT NOT NULL DEFAULT '',
                tech_stack TEXT NOT NULL DEFAULT '',
                outcomes TEXT NOT NULL DEFAULT '',
                links TEXT NOT NULL DEFAULT '',
                embedding_indexed BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )");

        _log.LogInformation("portfolio_projects table ready.");
    }

    // ── CRUD ──────────────────────────────────────────────────────────────────

    public async Task<List<PortfolioProject>> GetAll()
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        var rows = await c.QueryAsync<dynamic>(
            "SELECT * FROM portfolio_projects ORDER BY created_at DESC");

        return rows.Select(Map).ToList();
    }

    public async Task<PortfolioProject?> GetById(Guid id)
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        var row = await c.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT * FROM portfolio_projects WHERE id=@id", new { id });

        return row == null ? null : Map(row);
    }

    public async Task<PortfolioProject> Upsert(PortfolioProject p)
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        await c.ExecuteAsync(@"
            INSERT INTO portfolio_projects
                (id, title, industry, tags, problem, solution, tech_stack, outcomes, links, embedding_indexed, created_at)
            VALUES
                (@Id, @Title, @Industry, @Tags, @Problem, @Solution, @TechStack, @Outcomes, @Links, @EmbeddingIndexed, @CreatedAt)
            ON CONFLICT (id) DO UPDATE SET
                title = EXCLUDED.title,
                industry = EXCLUDED.industry,
                tags = EXCLUDED.tags,
                problem = EXCLUDED.problem,
                solution = EXCLUDED.solution,
                tech_stack = EXCLUDED.tech_stack,
                outcomes = EXCLUDED.outcomes,
                links = EXCLUDED.links,
                embedding_indexed = EXCLUDED.embedding_indexed",
            new
            {
                p.Id, p.Title, p.Industry, Tags = p.Tags,
                p.Problem, p.Solution, p.TechStack, p.Outcomes, p.Links,
                p.EmbeddingIndexed, p.CreatedAt
            });

        return p;
    }

    public async Task Delete(Guid id)
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        await c.ExecuteAsync("DELETE FROM portfolio_projects WHERE id=@id", new { id });

        // Also remove from Azure AI Search
        try { await DeleteFromSearch(id); }
        catch (Exception ex) { _log.LogWarning(ex, "Failed to delete from AI Search for {0}", id); }
    }

    // ── Azure AI Search Embedding ─────────────────────────────────────────────

    public async Task<(bool ok, string message)> IndexEmbedding(Guid id)
    {
        var project = await GetById(id);
        if (project == null) return (false, "Project not found.");

        var settings = await _settings.GetAll();

        var aoEndpoint  = settings.GetValueOrDefault(SettingKeys.AzureOpenAiEndpoint, "");
        var aoKey       = settings.GetValueOrDefault(SettingKeys.AzureOpenAiKey, "");
        var aoEmbedDep  = settings.GetValueOrDefault(SettingKeys.AzureOpenAiEmbeddingDeployment, "text-embedding-3-small");
        var searchEp    = settings.GetValueOrDefault(SettingKeys.AzureSearchEndpoint, "");
        var searchKey   = settings.GetValueOrDefault(SettingKeys.AzureSearchKey, "");
        var searchIndex = settings.GetValueOrDefault(SettingKeys.AzureSearchIndex, "portfolio");

        if (string.IsNullOrWhiteSpace(aoEndpoint) || string.IsNullOrWhiteSpace(aoKey))
            return (false, "Azure OpenAI endpoint/key not configured in Settings.");

        if (string.IsNullOrWhiteSpace(searchEp) || string.IsNullOrWhiteSpace(searchKey))
            return (false, "Azure AI Search endpoint/key not configured in Settings.");

        // 1. Generate embedding
        float[] embedding;
        try
        {
            embedding = await GenerateEmbedding(aoEndpoint, aoKey, aoEmbedDep, BuildText(project));
        }
        catch (Exception ex)
        {
            return (false, $"Embedding failed: {ex.Message}");
        }

        // 2. Ensure index exists
        try
        {
            await EnsureSearchIndex(searchEp, searchKey, searchIndex);
        }
        catch (Exception ex)
        {
            return (false, $"Index creation failed: {ex.Message}");
        }

        // 3. Upload document
        try
        {
            await UploadToSearch(searchEp, searchKey, searchIndex, project, embedding);
        }
        catch (Exception ex)
        {
            return (false, $"Upload to AI Search failed: {ex.Message}");
        }

        // 4. Mark indexed in Postgres
        project.EmbeddingIndexed = true;
        await Upsert(project);

        return (true, "Indexed successfully.");
    }

    public async Task<List<PortfolioProject>> SearchSimilar(string query, int topK = 3)
    {
        var settings = await _settings.GetAll();

        var aoEndpoint  = settings.GetValueOrDefault(SettingKeys.AzureOpenAiEndpoint, "");
        var aoKey       = settings.GetValueOrDefault(SettingKeys.AzureOpenAiKey, "");
        var aoEmbedDep  = settings.GetValueOrDefault(SettingKeys.AzureOpenAiEmbeddingDeployment, "text-embedding-3-small");
        var searchEp    = settings.GetValueOrDefault(SettingKeys.AzureSearchEndpoint, "");
        var searchKey   = settings.GetValueOrDefault(SettingKeys.AzureSearchKey, "");
        var searchIndex = settings.GetValueOrDefault(SettingKeys.AzureSearchIndex, "portfolio");

        if (string.IsNullOrWhiteSpace(aoEndpoint) || string.IsNullOrWhiteSpace(searchEp))
            return new List<PortfolioProject>();

        var embedding = await GenerateEmbedding(aoEndpoint, aoKey, aoEmbedDep, query);

        var client = _http.CreateClient();
        client.DefaultRequestHeaders.Add("api-key", searchKey);

        var url = $"{searchEp.TrimEnd('/')}/indexes/{searchIndex}/docs/search?api-version=2023-11-01";

        var body = JsonSerializer.Serialize(new
        {
            vectorQueries = new[]
            {
                new { kind = "vector", vector = embedding, exhaustive = true, fields = "embedding", k = topK }
            },
            select = "id,title,industry,tags,problem,solution,tech_stack,outcomes,links",
            top = topK
        });

        var resp = await client.PostAsync(url, new StringContent(body, Encoding.UTF8, "application/json"));
        var json = await resp.Content.ReadAsStringAsync();

        if (!resp.IsSuccessStatusCode)
        {
            _log.LogWarning("AI Search query failed: {0}", json);
            return new List<PortfolioProject>();
        }

        var doc = JsonDocument.Parse(json);
        var results = new List<PortfolioProject>();

        foreach (var item in doc.RootElement.GetProperty("value").EnumerateArray())
        {
            results.Add(new PortfolioProject
            {
                Id         = Guid.Parse(item.GetProperty("id").GetString() ?? ""),
                Title      = item.GetProperty("title").GetString() ?? "",
                Industry   = item.GetProperty("industry").GetString() ?? "",
                Tags       = item.GetProperty("tags").EnumerateArray().Select(t => t.GetString() ?? "").ToArray(),
                Problem    = item.GetProperty("problem").GetString() ?? "",
                Solution   = item.GetProperty("solution").GetString() ?? "",
                TechStack  = item.GetProperty("tech_stack").GetString() ?? "",
                Outcomes   = item.GetProperty("outcomes").GetString() ?? "",
                Links      = item.GetProperty("links").GetString() ?? "",
            });
        }

        return results;
    }

    // ── Document Extraction ───────────────────────────────────────────────────

    public async Task<(bool ok, string message, PortfolioProject? project)> ExtractFromDocument(
        string fileName, byte[] fileBytes)
    {
        var settings = await _settings.GetAll();
        var aoEndpoint  = settings.GetValueOrDefault(SettingKeys.AzureOpenAiEndpoint, "");
        var aoKey       = settings.GetValueOrDefault(SettingKeys.AzureOpenAiKey, "");
        var aoDeployment = settings.GetValueOrDefault(SettingKeys.AzureOpenAiDeployment, "");

        if (string.IsNullOrWhiteSpace(aoEndpoint) || string.IsNullOrWhiteSpace(aoKey) || string.IsNullOrWhiteSpace(aoDeployment))
            return (false, "Azure OpenAI not configured in Settings.", null);

        // Extract text from file
        string text;
        try
        {
            text = ExtractText(fileName, fileBytes);
            if (string.IsNullOrWhiteSpace(text))
                return (false, "Could not extract text from the file.", null);
            if (text.Length > 12000) text = text[..12000]; // trim to fit context
        }
        catch (Exception ex)
        {
            return (false, $"File read error: {ex.Message}", null);
        }

        // Call Azure OpenAI to extract fields
        var prompt = $$"""
You are a business analyst. Extract project details from the document below and return ONLY valid JSON with these exact keys:
{
  "title": "project name",
  "industry": "industry sector",
  "tags": ["tag1", "tag2"],
  "problem": "problem statement",
  "solution": "solution description",
  "techStack": "technologies used",
  "outcomes": "results and metrics",
  "links": ""
}
If a field is not found, use an empty string or empty array. Return ONLY JSON, no explanation.

DOCUMENT:
{{text}}
""";

        try
        {
            var client = _http.CreateClient();
            client.DefaultRequestHeaders.Add("api-key", aoKey);

            var url = $"{aoEndpoint.TrimEnd('/')}/openai/deployments/{aoDeployment}/chat/completions?api-version=2024-02-01";
            var body = JsonSerializer.Serialize(new
            {
                messages = new[]
                {
                    new { role = "user", content = prompt }
                },
                max_completion_tokens = 1000
            });

            var resp = await client.PostAsync(url, new StringContent(body, System.Text.Encoding.UTF8, "application/json"));
            var json = await resp.Content.ReadAsStringAsync();

            if (!resp.IsSuccessStatusCode)
                return (false, $"OpenAI error: {json}", null);

            var doc = JsonDocument.Parse(json);
            var content = doc.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString() ?? "";

            // Strip markdown fences if present
            content = content.Trim();
            if (content.StartsWith("```")) content = content.Split('\n', 2)[1];
            if (content.EndsWith("```")) content = content[..content.LastIndexOf("```")];
            content = content.Trim();

            var parsed = JsonDocument.Parse(content);
            var root = parsed.RootElement;

            string Str(string key) => root.TryGetProperty(key, out var v) ? v.GetString() ?? "" : "";
            string[] Arr(string key)
            {
                if (!root.TryGetProperty(key, out var v)) return Array.Empty<string>();
                return v.ValueKind == JsonValueKind.Array
                    ? v.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x != "").ToArray()
                    : Array.Empty<string>();
            }

            var project = new PortfolioProject
            {
                Title     = Str("title"),
                Industry  = Str("industry"),
                Tags      = Arr("tags"),
                Problem   = Str("problem"),
                Solution  = Str("solution"),
                TechStack = Str("techStack"),
                Outcomes  = Str("outcomes"),
                Links     = Str("links"),
            };

            return (true, "Extracted successfully.", project);
        }
        catch (Exception ex)
        {
            return (false, $"Extraction failed: {ex.Message}", null);
        }
    }

    private static string ExtractText(string fileName, byte[] bytes)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();

        if (ext == ".txt" || ext == ".md")
            return System.Text.Encoding.UTF8.GetString(bytes);

        if (ext == ".pdf")
            return ExtractPdfText(bytes);

        if (ext == ".docx")
            return ExtractDocxText(bytes);

        throw new NotSupportedException($"File type '{ext}' not supported. Use PDF, DOCX, or TXT.");
    }

    private static string ExtractPdfText(byte[] bytes)
    {
        // Simple PDF text extraction — reads stream objects
        var text = System.Text.Encoding.Latin1.GetString(bytes);
        var sb = new System.Text.StringBuilder();
        var i = 0;
        while (i < text.Length)
        {
            var bt = text.IndexOf("BT", i, StringComparison.Ordinal);
            if (bt < 0) break;
            var et = text.IndexOf("ET", bt, StringComparison.Ordinal);
            if (et < 0) break;
            var block = text[bt..et];
            // extract text inside parentheses (Tj / TJ operators)
            var j = 0;
            while (j < block.Length)
            {
                var op = block.IndexOf('(', j);
                if (op < 0) break;
                var cp = block.IndexOf(')', op);
                if (cp < 0) break;
                sb.Append(block[(op + 1)..cp]).Append(' ');
                j = cp + 1;
            }
            i = et + 2;
        }
        var result = sb.ToString().Trim();
        // Fallback: if nothing extracted, try raw text search
        if (result.Length < 50)
        {
            var raw = System.Text.Encoding.UTF8.GetString(bytes);
            var lines = raw.Split('\n')
                .Where(l => l.TrimStart().StartsWith("/") == false && l.Length > 10 && l.All(c => c >= 32 && c < 127))
                .Take(200);
            result = string.Join("\n", lines);
        }
        return result;
    }

    private static string ExtractDocxText(byte[] bytes)
    {
        using var ms = new System.IO.MemoryStream(bytes);
        using var zip = new System.IO.Compression.ZipArchive(ms, System.IO.Compression.ZipArchiveMode.Read);
        var entry = zip.GetEntry("word/document.xml");
        if (entry == null) return "";
        using var sr = new System.IO.StreamReader(entry.Open());
        var xml = sr.ReadToEnd();
        // Strip XML tags, keep text
        var sb = new System.Text.StringBuilder();
        var inTag = false;
        foreach (var c in xml)
        {
            if (c == '<') { inTag = true; sb.Append(' '); continue; }
            if (c == '>') { inTag = false; continue; }
            if (!inTag) sb.Append(c);
        }
        return System.Text.RegularExpressions.Regex.Replace(sb.ToString(), @"\s+", " ").Trim();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static string BuildText(PortfolioProject p) =>
        $"Title: {p.Title}\nIndustry: {p.Industry}\nProblem: {p.Problem}\nSolution: {p.Solution}\nTech Stack: {p.TechStack}\nOutcomes: {p.Outcomes}";

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

    private async Task EnsureSearchIndex(string endpoint, string key, string indexName)
    {
        var client = _http.CreateClient();
        client.DefaultRequestHeaders.Add("api-key", key);

        // Check if index exists
        var checkUrl = $"{endpoint.TrimEnd('/')}/indexes/{indexName}?api-version=2023-11-01";
        var checkResp = await client.GetAsync(checkUrl);
        if (checkResp.IsSuccessStatusCode) return;

        // Create index with vector field (1536 dims for text-embedding-3-small)
        var createUrl = $"{endpoint.TrimEnd('/')}/indexes?api-version=2023-11-01";
        var indexDef = JsonSerializer.Serialize(new
        {
            name = indexName,
            fields = new object[]
            {
                new { name = "id",        type = "Edm.String",              key = true,  searchable = false, filterable = true  },
                new { name = "title",     type = "Edm.String",              key = false, searchable = true,  filterable = true  },
                new { name = "industry",  type = "Edm.String",              key = false, searchable = true,  filterable = true  },
                new { name = "tags",      type = "Collection(Edm.String)",  key = false, searchable = true,  filterable = true  },
                new { name = "problem",   type = "Edm.String",              key = false, searchable = true,  filterable = false },
                new { name = "solution",  type = "Edm.String",              key = false, searchable = true,  filterable = false },
                new { name = "tech_stack",type = "Edm.String",              key = false, searchable = true,  filterable = false },
                new { name = "outcomes",  type = "Edm.String",              key = false, searchable = true,  filterable = false },
                new { name = "links",     type = "Edm.String",              key = false, searchable = false, filterable = false },
                new
                {
                    name = "embedding",
                    type = "Collection(Edm.Single)",
                    searchable = true,
                    vectorSearchDimensions = 1536,
                    vectorSearchProfileName = "portfolio-profile"
                }
            },
            vectorSearch = new
            {
                profiles = new[] { new { name = "portfolio-profile", algorithmConfigurationName = "portfolio-hnsw" } },
                algorithms = new[] { new { name = "portfolio-hnsw", kind = "hnsw" } }
            }
        });

        var createResp = await client.PostAsync(createUrl, new StringContent(indexDef, Encoding.UTF8, "application/json"));
        var createJson = await createResp.Content.ReadAsStringAsync();

        if (!createResp.IsSuccessStatusCode)
            throw new Exception($"Index creation failed: {createJson}");
    }

    private async Task UploadToSearch(string endpoint, string key, string indexName, PortfolioProject p, float[] embedding)
    {
        var client = _http.CreateClient();
        client.DefaultRequestHeaders.Add("api-key", key);

        var url = $"{endpoint.TrimEnd('/')}/indexes/{indexName}/docs/index?api-version=2023-11-01";

        var doc = new
        {
            value = new[]
            {
                new
                {
                    @search_action = "upload",
                    id        = p.Id.ToString(),
                    title     = p.Title,
                    industry  = p.Industry,
                    tags      = p.Tags,
                    problem   = p.Problem,
                    solution  = p.Solution,
                    tech_stack = p.TechStack,
                    outcomes  = p.Outcomes,
                    links     = p.Links,
                    embedding = embedding
                }
            }
        };

        var body = JsonSerializer.Serialize(doc, new JsonSerializerOptions { PropertyNamingPolicy = null });
        // fix @search_action key
        body = body.Replace("\"search_action\"", "\"@search.action\"");

        var resp = await client.PostAsync(url, new StringContent(body, Encoding.UTF8, "application/json"));
        var json = await resp.Content.ReadAsStringAsync();

        if (!resp.IsSuccessStatusCode)
            throw new Exception($"AI Search upload failed: {json}");
    }

    private async Task DeleteFromSearch(Guid id)
    {
        var settings = await _settings.GetAll();
        var searchEp    = settings.GetValueOrDefault(SettingKeys.AzureSearchEndpoint, "");
        var searchKey   = settings.GetValueOrDefault(SettingKeys.AzureSearchKey, "");
        var searchIndex = settings.GetValueOrDefault(SettingKeys.AzureSearchIndex, "portfolio");

        if (string.IsNullOrWhiteSpace(searchEp) || string.IsNullOrWhiteSpace(searchKey)) return;

        var client = _http.CreateClient();
        client.DefaultRequestHeaders.Add("api-key", searchKey);

        var url = $"{searchEp.TrimEnd('/')}/indexes/{searchIndex}/docs/index?api-version=2023-11-01";
        var body = $"{{\"value\":[{{\"@search.action\":\"delete\",\"id\":\"{id}\"}}]}}";

        await client.PostAsync(url, new StringContent(body, Encoding.UTF8, "application/json"));
    }

    private static PortfolioProject Map(dynamic r) => new()
    {
        Id               = r.id,
        Title            = r.title ?? "",
        Industry         = r.industry ?? "",
        Tags             = r.tags ?? Array.Empty<string>(),
        Problem          = r.problem ?? "",
        Solution         = r.solution ?? "",
        TechStack        = r.tech_stack ?? "",
        Outcomes         = r.outcomes ?? "",
        Links            = r.links ?? "",
        EmbeddingIndexed = r.embedding_indexed ?? false,
        CreatedAt        = r.created_at,
    };
}
