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

    // Explicit column list (excludes embedding_vec — Dapper/Npgsql can't map the
    // pgvector "vector" type to dynamic/object without the Pgvector.Npgsql plugin).
    private const string SelectColumns =
        "id, title, industry, tags, problem, solution, tech_stack, outcomes, links, youtube_links, ios_link, android_link, web_link, embedding_indexed, created_at";

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

        // Migration: add youtube_links if not exists
        try { await c.ExecuteAsync("ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS youtube_links TEXT NOT NULL DEFAULT \'\'"); } catch { }

        // Migration: iOS / Android / Web links — all optional, default empty so existing
        // projects and generation keep working untouched until these are filled in.
        try { await c.ExecuteAsync("ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS ios_link TEXT NOT NULL DEFAULT \'\'"); } catch { }
        try { await c.ExecuteAsync("ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS android_link TEXT NOT NULL DEFAULT \'\'"); } catch { }
        try { await c.ExecuteAsync("ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS web_link TEXT NOT NULL DEFAULT \'\'"); } catch { }

        // Migration: pgvector support (alternative to Azure AI Search)
        try { await c.ExecuteAsync("CREATE EXTENSION IF NOT EXISTS vector"); } catch (Exception ex) { _log.LogWarning("pgvector extension not available: {0}", ex.Message); }
        try { await c.ExecuteAsync("ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS embedding_vec vector(1536)"); } catch (Exception ex) { _log.LogWarning("embedding_vec column not added: {0}", ex.Message); }

        _log.LogInformation("portfolio_projects table ready.");
    }

    // ── CRUD ──────────────────────────────────────────────────────────────────

    public async Task<List<PortfolioProject>> GetAll()
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        var rows = await c.QueryAsync<dynamic>(
            $"SELECT {SelectColumns} FROM portfolio_projects ORDER BY created_at DESC");

        return rows.Select(Map).ToList();
    }

    public async Task<PortfolioProject?> GetById(Guid id)
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        var row = await c.QuerySingleOrDefaultAsync<dynamic>(
            $"SELECT {SelectColumns} FROM portfolio_projects WHERE id=@id", new { id });

        return row == null ? null : Map(row);
    }

    public async Task<PortfolioProject> Upsert(PortfolioProject p)
    {
        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        await c.ExecuteAsync(@"
            INSERT INTO portfolio_projects
                (id, title, industry, tags, problem, solution, tech_stack, outcomes, links, youtube_links, ios_link, android_link, web_link, embedding_indexed, created_at)
            VALUES
                (@Id, @Title, @Industry, @Tags, @Problem, @Solution, @TechStack, @Outcomes, @Links, @YoutubeLinks, @IosLink, @AndroidLink, @WebLink, @EmbeddingIndexed, @CreatedAt)
            ON CONFLICT (id) DO UPDATE SET
                title = EXCLUDED.title,
                industry = EXCLUDED.industry,
                tags = EXCLUDED.tags,
                problem = EXCLUDED.problem,
                solution = EXCLUDED.solution,
                tech_stack = EXCLUDED.tech_stack,
                outcomes = EXCLUDED.outcomes,
                links = EXCLUDED.links,
                youtube_links = EXCLUDED.youtube_links,
                ios_link = EXCLUDED.ios_link,
                android_link = EXCLUDED.android_link,
                web_link = EXCLUDED.web_link,
                embedding_indexed = EXCLUDED.embedding_indexed",
            new
            {
                p.Id, p.Title, p.Industry, Tags = p.Tags,
                p.Problem, p.Solution, p.TechStack, p.Outcomes, p.Links, p.YoutubeLinks,
                p.IosLink, p.AndroidLink, p.WebLink,
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
        var vectorProvider = settings.GetValueOrDefault(SettingKeys.VectorProvider, "azure_search");

        if (vectorProvider == "pgvector")
            return await IndexEmbeddingPgVector(project, settings);

        var searchEp    = settings.GetValueOrDefault(SettingKeys.AzureSearchEndpoint, "");
        var searchKey   = settings.GetValueOrDefault(SettingKeys.AzureSearchKey, "");
        var searchIndex = settings.GetValueOrDefault(SettingKeys.AzureSearchIndex, "portfolio");

        if (string.IsNullOrWhiteSpace(searchEp) || string.IsNullOrWhiteSpace(searchKey))
            return (false, "Azure AI Search endpoint/key not configured in Settings.");

        // 1. Generate embedding
        float[] embedding;
        try
        {
            embedding = await GenerateEmbedding(settings, BuildText(project));
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
        var vectorProvider = settings.GetValueOrDefault(SettingKeys.VectorProvider, "azure_search");

        if (vectorProvider == "pgvector")
            return await SearchSimilarPgVector(query, topK, settings);

        var searchEp    = settings.GetValueOrDefault(SettingKeys.AzureSearchEndpoint, "");
        var searchKey   = settings.GetValueOrDefault(SettingKeys.AzureSearchKey, "");
        var searchIndex = settings.GetValueOrDefault(SettingKeys.AzureSearchIndex, "portfolio");

        if (string.IsNullOrWhiteSpace(settings.GetValueOrDefault(SettingKeys.GeminiApiKey, "")) || string.IsNullOrWhiteSpace(searchEp))
            return new List<PortfolioProject>();

        var embedding = await GenerateEmbedding(settings, query);

        var client = _http.CreateClient();
        client.DefaultRequestHeaders.Add("api-key", searchKey);

        var url = $"{searchEp.TrimEnd('/')}/indexes/{searchIndex}/docs/search?api-version=2024-05-01-preview";

        // Hybrid search: keyword + vector for better relevance
        var searchText = query.Length > 200 ? query[..200] : query;
        var body = JsonSerializer.Serialize(new
        {
            search = searchText,
            queryType = "simple",
            searchMode = "any",
            vectorQueries = new[]
            {
                new { kind = "vector", vector = embedding, exhaustive = true, fields = "embedding", k = Math.Max(topK * 3, 10) }
            },
            select = "id,title,industry,tags,problem,solution,tech_stack,outcomes,links,youtube_links",
            top = Math.Max(topK * 3, 10)
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
                Links        = item.GetProperty("links").GetString() ?? "",
                YoutubeLinks = item.TryGetProperty("youtube_links", out var yl) ? yl.GetString() ?? "" : "",
            });
        }

        // Deduplicate by title — keep first occurrence (highest score)
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        results = results.Where(r => seen.Add(r.Title)).ToList();

        // Hydrate from PostgreSQL — index docs can be stale (e.g. YouTube links
        // added after last re-index). PG is source of truth; search order kept.
        results = await HydrateFromDb(results);

        return results.Take(topK).ToList();
    }

    private async Task<List<PortfolioProject>> HydrateFromDb(List<PortfolioProject> hits)
    {
        if (hits.Count == 0) return hits;
        try
        {
            var cs = _settings.ConnectionString;
            if (string.IsNullOrEmpty(cs)) return hits;

            await using var c = new NpgsqlConnection(cs);
            await c.OpenAsync();

            var ids = hits.Select(h => h.Id).ToArray();
            var rows = await c.QueryAsync<dynamic>(
                $"SELECT {SelectColumns} FROM portfolio_projects WHERE id = ANY(@ids)", new { ids });

            var fresh = rows.Select(Map).Cast<PortfolioProject>().ToDictionary(p => p.Id, p => p);

            // Preserve search relevance order; swap in fresh DB record when found
            return hits.Select(h => fresh.TryGetValue(h.Id, out var f) ? f : h).ToList();
        }
        catch
        {
            return hits; // never break search on hydration failure
        }
    }

    // ── pgvector (alternative to Azure AI Search) ──────────────────────────────

    private static string EmbeddingToVectorLiteral(float[] embedding) =>
        "[" + string.Join(",", embedding.Select(v => v.ToString(System.Globalization.CultureInfo.InvariantCulture))) + "]";

    private async Task<(bool ok, string message)> IndexEmbeddingPgVector(PortfolioProject project, Dictionary<string, string> settings)
    {
        if (string.IsNullOrWhiteSpace(settings.GetValueOrDefault(SettingKeys.GeminiApiKey, "")))
            return (false, "Gemini API key not configured in Settings (required for embeddings).");

        float[] embedding;
        try
        {
            embedding = await GenerateEmbedding(settings, BuildText(project));
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Gemini embedding failed for project {0}", project.Id);
            return (false, $"Embedding failed: {ex.Message}");
        }

        try
        {
            var cs = _settings.ConnectionString;
            await using var c = new NpgsqlConnection(cs);
            await c.OpenAsync();
            await c.ExecuteAsync(
                "UPDATE portfolio_projects SET embedding_vec = @vec::vector, embedding_indexed = TRUE WHERE id = @id",
                new { vec = EmbeddingToVectorLiteral(embedding), id = project.Id });
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "pgvector write failed for project {0}", project.Id);
            return (false, $"pgvector write failed: {ex.Message}");
        }

        return (true, "Indexed successfully (pgvector).");
    }

    /// <summary>
    /// Regenerates embeddings for ALL portfolio projects and stores them in
    /// the pgvector "embedding_vec" column. Used by the Settings page
    /// "Reindex All (pgvector)" button when switching to pgvector.
    /// </summary>
    public async Task<(bool ok, string message)> ReindexAllPgVector()
    {
        var settings = await _settings.GetAll();

        if (string.IsNullOrWhiteSpace(settings.GetValueOrDefault(SettingKeys.GeminiApiKey, "")))
            return (false, "Gemini API key not configured in Settings (required for embeddings).");

        var projects = await GetAll();
        int ok = 0, failed = 0;

        foreach (var project in projects)
        {
            var (success, _) = await IndexEmbeddingPgVector(project, settings);
            if (success) ok++; else failed++;
        }

        return (true, $"Reindexed {ok} project(s) into pgvector." + (failed > 0 ? $" {failed} failed." : ""));
    }

    private async Task<List<PortfolioProject>> SearchSimilarPgVector(string query, int topK, Dictionary<string, string> settings)
    {
        if (string.IsNullOrWhiteSpace(settings.GetValueOrDefault(SettingKeys.GeminiApiKey, "")))
            return new List<PortfolioProject>();

        float[] embedding;
        try
        {
            embedding = await GenerateEmbedding(settings, query);
        }
        catch (Exception ex)
        {
            _log.LogWarning("pgvector embedding failed: {0}", ex.Message);
            return new List<PortfolioProject>();
        }

        try
        {
            var cs = _settings.ConnectionString;
            await using var c = new NpgsqlConnection(cs);
            await c.OpenAsync();

            var rows = await c.QueryAsync<dynamic>(
                $@"SELECT {SelectColumns} FROM portfolio_projects
                  WHERE embedding_vec IS NOT NULL
                  ORDER BY embedding_vec <=> @vec::vector
                  LIMIT @topK",
                new { vec = EmbeddingToVectorLiteral(embedding), topK });

            return rows.Select(Map).ToList();
        }
        catch (Exception ex)
        {
            _log.LogWarning("pgvector search failed: {0}", ex.Message);
            return new List<PortfolioProject>();
        }
    }

    // ── TESTING: portfolio match-threshold experiment ──────────────────────────
    // New, isolated method. Does not replace or alter SearchSimilarPgVector above
    // — that method (and everything that calls it) is untouched. This is used only
    // by the new "Portfolio Matching (Testing)" panel and its test-only endpoint,
    // so nothing about existing proposal generation is affected by this code.
    public class PortfolioMatchResult
    {
        public Guid Id { get; set; }
        public string Title { get; set; } = "";
        public string Industry { get; set; } = "";
        public double Score { get; set; } // similarity 0..1 (1 = identical), derived from cosine distance
        public double Distance { get; set; } // raw cosine distance from pgvector, 0 = identical (Score = 1 - Distance)
        public int Level { get; set; } // 1-5 display rating derived from Score, see ScoreToMatchLevel
        public bool PassesThreshold { get; set; }
    }

    public const double DefaultPortfolioMatchThreshold = 0.75;

    public double GetPortfolioMatchThreshold(Dictionary<string, string> settings)
    {
        var raw = settings.GetValueOrDefault(SettingKeys.PortfolioMatchThreshold, "");
        return double.TryParse(raw, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var v)
            ? v
            : DefaultPortfolioMatchThreshold;
    }

    // 1-5 match-level scale — user-facing replacement for the raw 0.75-style decimal
    // above (that method/constant stay untouched for back-compat, just unused now).
    // Settings now store an integer level 1-5; this maps it to the internal
    // cosine-similarity cutoff used only by the test panel.
    private static readonly double[] MatchLevelToScore = { 0.50, 0.60, 0.70, 0.80, 0.90 }; // index 0 = level 1

    public const int DefaultPortfolioMatchLevel = 3;

    public int GetPortfolioMatchLevel(Dictionary<string, string> settings)
    {
        var raw = settings.GetValueOrDefault(SettingKeys.PortfolioMatchThreshold, "");
        if (!int.TryParse(raw, out var level)) level = DefaultPortfolioMatchLevel;
        return Math.Clamp(level, 1, 5);
    }

    public static int ScoreToMatchLevel(double score)
    {
        for (int i = MatchLevelToScore.Length - 1; i >= 0; i--)
            if (score >= MatchLevelToScore[i]) return i + 1;
        return 1;
    }

    // TESTING ONLY — total vs indexed portfolio item counts, shown in the test
    // panel so a "nothing matches" result can be told apart from "nothing is
    // indexed". Read-only, isolated helper, not used by any live code path.
    private async Task<(int total, int indexed)> GetPortfolioIndexCounts()
    {
        try
        {
            var cs = _settings.ConnectionString;
            await using var c = new NpgsqlConnection(cs);
            await c.OpenAsync();
            var total   = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM portfolio_projects");
            var indexed = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM portfolio_projects WHERE embedding_vec IS NOT NULL");
            return (total, indexed);
        }
        catch (Exception ex)
        {
            _log.LogWarning("GetPortfolioIndexCounts failed: {0}", ex.Message);
            return (0, 0);
        }
    }

    public async Task<(bool ok, string message, int thresholdLevel, double thresholdScore, List<PortfolioMatchResult> matches, int totalPortfolioItems, int indexedPortfolioItems)> TestMatchWithScores(string jobText, int topK = 5)
    {
        var settings = await _settings.GetAll();
        var thresholdLevel = GetPortfolioMatchLevel(settings);
        var thresholdScore = MatchLevelToScore[thresholdLevel - 1];
        var (total, indexed) = await GetPortfolioIndexCounts();

        if (string.IsNullOrWhiteSpace(settings.GetValueOrDefault(SettingKeys.GeminiApiKey, "")))
            return (false, "Gemini API key not configured in Settings (required for embeddings).", thresholdLevel, thresholdScore, new(), total, indexed);

        if (string.IsNullOrWhiteSpace(jobText))
            return (false, "Job text is required.", thresholdLevel, thresholdScore, new(), total, indexed);

        float[] embedding;
        try
        {
            embedding = await GenerateEmbedding(settings, jobText);
        }
        catch (Exception ex)
        {
            return (false, $"Embedding failed: {ex.Message}", thresholdLevel, thresholdScore, new(), total, indexed);
        }

        try
        {
            var cs = _settings.ConnectionString;
            await using var c = new NpgsqlConnection(cs);
            await c.OpenAsync();

            var rows = await c.QueryAsync<dynamic>(
                @"SELECT id, title, industry, (embedding_vec <=> @vec::vector) AS distance
                  FROM portfolio_projects
                  WHERE embedding_vec IS NOT NULL
                  ORDER BY embedding_vec <=> @vec::vector
                  LIMIT @topK",
                new { vec = EmbeddingToVectorLiteral(embedding), topK });

            var matches = rows.Select(r =>
            {
                double distance = (double)r.distance;
                double score = 1.0 - distance; // cosine distance -> similarity
                return new PortfolioMatchResult
                {
                    Id = (Guid)r.id,
                    Title = (string)r.title,
                    Industry = (string)r.industry,
                    Score = Math.Round(score, 4),
                    Distance = Math.Round(distance, 4),
                    Level = ScoreToMatchLevel(score),
                    PassesThreshold = score >= thresholdScore,
                };
            }).ToList();

            return (true, "ok", thresholdLevel, thresholdScore, matches, total, indexed);
        }
        catch (Exception ex)
        {
            _log.LogWarning("Test match-with-scores failed: {0}", ex.Message);
            return (false, $"Search failed: {ex.Message}", thresholdLevel, thresholdScore, new(), total, indexed);
        }
    }

    // ── TESTING: preview email generation (fallback / multi-link) ──────────────
    // New, fully separate from ArtifactsService.EmailPrompt/BuildLinkBlock — does
    // not read or modify those. Powers the "generated email preview" inside the
    // test panel only. Not wired into any live proposal generation path.
    public class TestEmailPreview
    {
        public string Subject { get; set; } = "";
        public string Body { get; set; } = "";
        public int MatchesUsed { get; set; }
    }

    // Greeting mirrors the live EmailPrompt's rule: first name if we have a client
    // name for this test, else the generic fallback.
    private static string TestGreetingRule(string clientFirstName) =>
        string.IsNullOrWhiteSpace(clientFirstName)
            ? "Start with exactly: \"Hi there,\" on its own line (no client name available in this test)."
            : $"Start with exactly: \"Hi {clientFirstName},\" on its own line.";

    // Structure/order/word-count now mirror the live ArtifactsService.EmailPrompt()
    // (HOOK -> CREDIBILITY -> APPROACH -> CTA, 150-200 words) instead of a thinner
    // custom shape — this prompt is still separate code, not the live prompt itself.
    private static string TestNoMatchFallbackPrompt(string clientFirstName) => $@"You are writing a short PROPOSAL EMAIL BODY on behalf of Bhanu Gupta, a senior full-stack developer and AI consultant with 15+ years experience and 40+ projects delivered. This is a preview for a case where we do NOT have a closely matching past project to cite by name.

STRUCTURE — exact order, no section titles, no bullets:
1. HOOK (1-2 sentences): Mirror the client's core problem from the job description, in your own words. Do NOT start with ""I"".
2. CREDIBILITY (1 sentence): General only — e.g. ""We've delivered similar solutions in this space before."" Do NOT name any specific project, client, or company. No links.
3. APPROACH (2-3 sentences): Name concrete technologies/approach based on the job description. Show the work is already scoped.
4. CTA (1-2 sentences): Invite a reply, e.g. ""Worth 15 min this week?"" No pricing, no rates, no numbers about cost.

RULES:
- {TestGreetingRule(clientFirstName)}
- Banned filler: ""great fit"", ""passionate"", ""I'd love to"", ""excited"", ""context-aware"", ""cutting-edge"", ""seamless"".
- Body: 150-200 words.
- No signature, no subject line.

Return only the email body text.";

    private static string TestMultiMatchLinkPrompt(string clientFirstName) => $@"You are writing a short PROPOSAL EMAIL BODY on behalf of Bhanu Gupta, a senior full-stack developer and AI consultant with 15+ years experience and 40+ projects delivered. This is a preview for a case where we DO have relevant past project(s) — their names and links will be appended automatically right after your text. Do not write any links yourself, and do not describe project details beyond the name(s) you were given.

STRUCTURE — exact order, no section titles, no bullets:
1. HOOK (1-2 sentences): Mirror the client's core problem from the job description, in your own words. Do NOT start with ""I"".
2. CREDIBILITY (1-2 sentences): Introduce the given past project(s) by name as proof of relevant experience, format like ""On a comparable project, I built [what] — [why it's relevant here]."" The system appends full project details/links directly after this.
3. APPROACH (2-3 sentences): Name concrete technologies/approach based on the job description. Show the work is already scoped.
4. CTA (1-2 sentences): Invite a reply, e.g. ""Worth 15 min this week?"" No pricing, no rates.

RULES:
- {TestGreetingRule(clientFirstName)}
- Banned filler: ""great fit"", ""passionate"", ""I'd love to"", ""excited"", ""context-aware"", ""cutting-edge"", ""seamless"".
- Body: 150-200 words (excluding the link block appended after).
- No signature, no subject line.

Return only the email body text.";

    public async Task<(bool ok, string message, TestEmailPreview? preview, int thresholdLevel, double thresholdScore, List<PortfolioMatchResult> matches, int totalPortfolioItems, int indexedPortfolioItems)> TestGenerateEmailPreview(string jobText, int topK = 5, string clientName = "")
    {
        var (ok, message, thresholdLevel, thresholdScore, matches, total, indexed) = await TestMatchWithScores(jobText, topK);
        if (!ok) return (false, message, null, thresholdLevel, thresholdScore, matches, total, indexed);

        var settings = await _settings.GetAll();
        var clientFirstName = string.IsNullOrWhiteSpace(clientName) ? "" : clientName.Trim().Split(' ')[0];

        // Only cite a project by name if it actually has a link to back it up — naming
        // a project with zero proof (no iOS/Android/Web/YouTube link on file) reads as
        // padding. Check every passing candidate, not just the top-scored ones, and
        // skip linkless ones even if their score is higher than a linked runner-up.
        var passingByScore = matches.Where(m => m.PassesThreshold).OrderByDescending(m => m.Score).ToList();
        var passing = new List<(PortfolioMatchResult match, PortfolioProject full)>();
        foreach (var m in passingByScore)
        {
            if (passing.Count == 2) break;
            var full = await GetById(m.Id);
            if (full == null) continue;
            bool hasLink = !string.IsNullOrWhiteSpace(full.IosLink) || !string.IsNullOrWhiteSpace(full.AndroidLink)
                        || !string.IsNullOrWhiteSpace(full.WebLink) || !string.IsNullOrWhiteSpace(full.YoutubeLinks);
            if (hasLink) passing.Add((m, full));
        }

        try
        {
            var messages = new List<object>();
            string leadText;
            string linkBlock = "";

            if (passing.Count == 0)
            {
                messages.Add(new { role = "system", content = TestNoMatchFallbackPrompt(clientFirstName) });
                messages.Add(new { role = "user", content = $"JOB DESCRIPTION:\n{jobText}" });
                leadText = await TEKLead.Api.Services.Llm.LlmClient.ChatAsync(_http, settings, messages, 600);
            }
            else
            {
                messages.Add(new { role = "system", content = TestMultiMatchLinkPrompt(clientFirstName) });
                var projTitles = string.Join(", ", passing.Select(p => p.match.Title));
                messages.Add(new { role = "user", content = $"JOB DESCRIPTION:\n{jobText}\n\nPROJECT(S): {projTitles}" });
                leadText = await TEKLead.Api.Services.Llm.LlmClient.ChatAsync(_http, settings, messages, 600);

                var sb = new StringBuilder();
                foreach (var (_, full) in passing)
                {
                    sb.AppendLine();
                    sb.AppendLine($"Project Name: {full.Title}");
                    var yt = (full.YoutubeLinks ?? "").Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault() ?? "";
                    if (!string.IsNullOrWhiteSpace(full.IosLink))     sb.AppendLine($"iOS Link: {full.IosLink}");
                    if (!string.IsNullOrWhiteSpace(full.AndroidLink)) sb.AppendLine($"Android Link: {full.AndroidLink}");
                    if (!string.IsNullOrWhiteSpace(full.WebLink))     sb.AppendLine($"Web Link: {full.WebLink}");
                    if (!string.IsNullOrWhiteSpace(yt))               sb.AppendLine($"Youtube Demo: {yt}");
                }
                linkBlock = sb.ToString().TrimEnd('\n', '\r');
            }

            var body = leadText.Trim();
            if (!string.IsNullOrWhiteSpace(linkBlock))
                body = body + "\n\n" + linkBlock;

            var preview = new TestEmailPreview
            {
                Subject = "(preview only — subject line generation not included in this test)",
                Body = body,
                MatchesUsed = passing.Count,
            };

            return (true, "ok", preview, thresholdLevel, thresholdScore, matches, total, indexed);
        }
        catch (Exception ex)
        {
            _log.LogWarning("Test email preview generation failed: {0}", ex.Message);
            return (false, $"Preview generation failed: {ex.Message}", null, thresholdLevel, thresholdScore, matches, total, indexed);
        }
    }

    // ── TESTING: Enhanced tiered matching (industry + tags + semantic) ─────────
    // New, fully additive. Does NOT touch TestMatchWithScores / TestGenerateEmailPreview
    // above — those, and their prompts/UI, stay exactly as they are. This is a second,
    // independent scoring path shown as a separate block in the same test panel:
    // mirrors the manual reasoning "same industry done before" > "same task type,
    // different industry" > "semantic-only guess" instead of one blended cosine score.
    public class EnhancedMatchResult
    {
        public Guid Id { get; set; }
        public string Title { get; set; } = "";
        public string Industry { get; set; } = "";
        public string[] Tags { get; set; } = Array.Empty<string>();
        public double SemanticScore { get; set; }
        public double CombinedScore { get; set; }
        public bool IndustryMatch { get; set; }
        public List<string> MatchedTags { get; set; } = new();
        public string Tier { get; set; } = ""; // "Industry Match" | "Task Match" | "Industry (weak)" | "Semantic Only"
        public bool PassesThreshold { get; set; }
    }

    private const double EnhancedIndustryBonus     = 0.15; // industry match + a real tag overlap on top
    private const double EnhancedIndustryWeakBonus = 0.05; // industry-only, no specific tag overlap — small nudge, doesn't auto-pass
    private const double EnhancedTagBonusPerTag    = 0.05;
    private const double EnhancedTagBonusCap       = 0.15;

    // Stricter than a single-word overlap: for a multi-word field (tag/industry),
    // ALL of its significant words must appear in the JD, not just one. A single
    // shared generic word ("development", "compliance", "healthcare") used to be
    // enough to call it a match — that's how an irrelevant project like a women's
    // health app matched a Health Gorilla/FHIR job on nothing but "HIPAA Compliance"
    // sharing the word "HIPAA". Requiring the whole phrase makes that much harder.
    private static bool TokenOverlap(HashSet<string> jdTokens, HashSet<string> fieldTokens)
    {
        if (jdTokens.Count == 0 || fieldTokens.Count == 0) return false;
        foreach (var t in fieldTokens)
        {
            bool present = jdTokens.Contains(t);
            if (!present)
            {
                // substring fallback per-word for close variants (healthcare vs health)
                foreach (var b in jdTokens)
                {
                    if (t.Length >= 5 && b.Length >= 5 && (t.Contains(b) || b.Contains(t))) { present = true; break; }
                }
            }
            if (!present) return false;
        }
        return true;
    }

    public async Task<(bool ok, string message, int thresholdLevel, double thresholdScore, List<EnhancedMatchResult> matches, int totalPortfolioItems, int indexedPortfolioItems)> TestMatchEnhanced(string jobText, int topK = 5)
    {
        var settings = await _settings.GetAll();
        var thresholdLevel = GetPortfolioMatchLevel(settings);
        var thresholdScore = MatchLevelToScore[thresholdLevel - 1];
        var (total, indexed) = await GetPortfolioIndexCounts();

        if (string.IsNullOrWhiteSpace(settings.GetValueOrDefault(SettingKeys.GeminiApiKey, "")))
            return (false, "Gemini API key not configured in Settings (required for embeddings).", thresholdLevel, thresholdScore, new(), total, indexed);

        if (string.IsNullOrWhiteSpace(jobText))
            return (false, "Job text is required.", thresholdLevel, thresholdScore, new(), total, indexed);

        float[] embedding;
        try
        {
            embedding = await GenerateEmbedding(settings, jobText);
        }
        catch (Exception ex)
        {
            return (false, $"Embedding failed: {ex.Message}", thresholdLevel, thresholdScore, new(), total, indexed);
        }

        var jdTokens = Tokenize(jobText);
        var poolSize = Math.Max(topK * 4, 20);

        try
        {
            var cs = _settings.ConnectionString;
            await using var c = new NpgsqlConnection(cs);
            await c.OpenAsync();

            var rows = await c.QueryAsync<dynamic>(
                @"SELECT id, title, industry, tags, (embedding_vec <=> @vec::vector) AS distance
                  FROM portfolio_projects
                  WHERE embedding_vec IS NOT NULL
                  ORDER BY embedding_vec <=> @vec::vector
                  LIMIT @poolSize",
                new { vec = EmbeddingToVectorLiteral(embedding), poolSize });

            var scored = rows.Select(r =>
            {
                double distance = (double)r.distance;
                double semanticScore = 1.0 - distance;
                string industry = (string)(r.industry ?? "");
                string[] tags = r.tags ?? Array.Empty<string>();

                bool industryMatch = TokenOverlap(jdTokens, Tokenize(industry));
                var matchedTags = tags.Where(t => TokenOverlap(jdTokens, Tokenize(t))).ToList();
                bool hasTagMatch = matchedTags.Count > 0;

                string tier;
                double bonus;
                bool passes;

                if (industryMatch && hasTagMatch)
                {
                    tier = "Industry Match";
                    bonus = EnhancedIndustryBonus + Math.Min(matchedTags.Count * EnhancedTagBonusPerTag, EnhancedTagBonusCap);
                    passes = true; // strongest signal: right industry AND a specific overlapping tag
                }
                else if (hasTagMatch)
                {
                    tier = "Task Match";
                    bonus = Math.Min(matchedTags.Count * EnhancedTagBonusPerTag, EnhancedTagBonusCap);
                    passes = true; // same task type, different industry — still a real signal on its own
                }
                else if (industryMatch)
                {
                    tier = "Industry (weak)";
                    bonus = EnhancedIndustryWeakBonus; // industry label alone is weak — doesn't auto-pass
                    passes = semanticScore >= thresholdScore;
                }
                else
                {
                    tier = "Semantic Only";
                    bonus = 0;
                    passes = semanticScore >= thresholdScore;
                }

                double combined = Math.Min(1.0, semanticScore + bonus);

                return new EnhancedMatchResult
                {
                    Id = (Guid)r.id,
                    Title = (string)r.title,
                    Industry = industry,
                    Tags = tags,
                    SemanticScore = Math.Round(semanticScore, 4),
                    CombinedScore = Math.Round(combined, 4),
                    IndustryMatch = industryMatch,
                    MatchedTags = matchedTags,
                    Tier = tier,
                    PassesThreshold = passes,
                };
            })
            .OrderByDescending(m => m.CombinedScore)
            .Take(topK)
            .ToList();

            return (true, "ok", thresholdLevel, thresholdScore, scored, total, indexed);
        }
        catch (Exception ex)
        {
            _log.LogWarning("Enhanced match test failed: {0}", ex.Message);
            return (false, $"Search failed: {ex.Message}", thresholdLevel, thresholdScore, new(), total, indexed);
        }
    }

    /// <summary>
    /// Industry-aware portfolio retrieval.
    /// Pulls a wide hybrid-search pool, then re-ranks so projects whose industry
    /// matches the target industry come first. Guarantees at most topK results,
    /// with industry matches prioritised (1-2 industry matches + best semantic rest).
    /// </summary>
    // ── LIVE: promoted from the test panel's "enhanced tiered matching" ────────
    // Same tiering as TestMatchEnhanced (industry+tags full-phrase overlap boosts
    // semantic score; a bare industry/semantic-only match must still clear the
    // configured threshold). This is now the retrieval used by live proposal
    // generation (see ArtifactsService), replacing SearchSimilarSmart below —
    // that method is left in place, just unused by the live path now.
    //
    // Throws on real infra failure (no embedding key configured, embedding call
    // failed, DB error) so the caller can tell "search broke" apart from "search
    // ran fine and genuinely nothing cleared a tier" (an empty list here means the
    // latter — callers should NOT paper over that with an unrelated fallback project,
    // that's the exact bug this whole feature exists to fix).
    public async Task<List<PortfolioProject>> SearchSimilarEnhanced(string query, string? industry, int topK = 3)
    {
        var settings = await _settings.GetAll();
        if (string.IsNullOrWhiteSpace(settings.GetValueOrDefault(SettingKeys.GeminiApiKey, "")))
            throw new Exception("Gemini API key not configured in Settings (required for embeddings).");

        if (string.IsNullOrWhiteSpace(query))
            return new List<PortfolioProject>();

        var thresholdLevel = GetPortfolioMatchLevel(settings);
        var thresholdScore = MatchLevelToScore[thresholdLevel - 1];

        var embedding = await GenerateEmbedding(settings, query); // exceptions propagate to caller on purpose

        var jdTokens = Tokenize(query);
        if (!string.IsNullOrWhiteSpace(industry))
            foreach (var t in Tokenize(industry)) jdTokens.Add(t);

        var poolSize = Math.Max(topK * 4, 20);

        var cs = _settings.ConnectionString;
        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        var rows = await c.QueryAsync<dynamic>(
            $@"SELECT {SelectColumns}, (embedding_vec <=> @vec::vector) AS distance
              FROM portfolio_projects
              WHERE embedding_vec IS NOT NULL
              ORDER BY embedding_vec <=> @vec::vector
              LIMIT @poolSize",
            new { vec = EmbeddingToVectorLiteral(embedding), poolSize });

        var scored = rows.Select(r =>
        {
            var proj = Map(r);
            double distance = (double)r.distance;
            double semanticScore = 1.0 - distance;

            bool industryMatch = TokenOverlap(jdTokens, Tokenize(proj.Industry));
            var matchedTags = proj.Tags.Where(t => TokenOverlap(jdTokens, Tokenize(t))).ToList();
            bool hasTagMatch = matchedTags.Count > 0;

            double bonus;
            bool passes;
            if (industryMatch && hasTagMatch)
            {
                bonus = EnhancedIndustryBonus + Math.Min(matchedTags.Count * EnhancedTagBonusPerTag, EnhancedTagBonusCap);
                passes = true;
            }
            else if (hasTagMatch)
            {
                bonus = Math.Min(matchedTags.Count * EnhancedTagBonusPerTag, EnhancedTagBonusCap);
                passes = true;
            }
            else if (industryMatch)
            {
                bonus = EnhancedIndustryWeakBonus;
                passes = semanticScore >= thresholdScore;
            }
            else
            {
                bonus = 0;
                passes = semanticScore >= thresholdScore;
            }

            double combined = Math.Min(1.0, semanticScore + bonus);
            return new { proj, combined, passes };
        })
        .Where(x => x.passes)
        .OrderByDescending(x => x.combined)
        .Take(topK)
        .Select(x => x.proj)
        .ToList();

        return scored;
    }

    public async Task<List<PortfolioProject>> SearchSimilarSmart(string query, string? industry, int topK = 3)
    {
        // Wide pool via hybrid search
        var pool = await SearchSimilar(query, topK: 10);
        if (pool.Count == 0) return pool;

        if (string.IsNullOrWhiteSpace(industry))
            return pool.Take(topK).ToList();

        var industryTokens = Tokenize(industry);
        if (industryTokens.Count == 0)
            return pool.Take(topK).ToList();

        var matches = new List<PortfolioProject>();
        var rest    = new List<PortfolioProject>();

        foreach (var p in pool)
        {
            if (IndustryMatches(industryTokens, p))
                matches.Add(p);
            else
                rest.Add(p);
        }

        // Industry-first ordering: matched projects lead; within groups, projects
        // with YouTube demos float up (stable sort preserves semantic order otherwise)
        var ranked = new List<PortfolioProject>();
        ranked.AddRange(matches.OrderByDescending(p => !string.IsNullOrWhiteSpace(p.YoutubeLinks)));
        ranked.AddRange(rest.OrderByDescending(p => !string.IsNullOrWhiteSpace(p.YoutubeLinks)));
        return ranked.Take(topK).ToList();
    }

    private static bool IndustryMatches(HashSet<string> industryTokens, PortfolioProject p)
    {
        var projTokens = Tokenize(p.Industry);
        foreach (var t in p.Tags) foreach (var tt in Tokenize(t)) projTokens.Add(tt);

        foreach (var tok in industryTokens)
            if (projTokens.Contains(tok)) return true;

        // Substring fallback: "healthcare" vs "health"
        foreach (var a in industryTokens)
            foreach (var b in projTokens)
                if (a.Length >= 4 && b.Length >= 4 && (a.Contains(b) || b.Contains(a)))
                    return true;

        return false;
    }

    private static readonly HashSet<string> IndustryStopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "and", "the", "of", "for", "services", "service", "industry", "industries",
        "solutions", "company", "companies", "inc", "llc", "ltd", "other", "general"
    };

    private static HashSet<string> Tokenize(string? text)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(text)) return set;
        foreach (var raw in System.Text.RegularExpressions.Regex.Split(text.ToLowerInvariant(), @"[^a-z0-9]+"))
        {
            var w = raw.Trim();
            if (w.Length >= 3 && !IndustryStopWords.Contains(w)) set.Add(w);
        }
        return set;
    }

    // ── Document Extraction ───────────────────────────────────────────────────

    public async Task<(bool ok, string message, PortfolioProject? project)> ExtractFromDocument(
        string fileName, byte[] fileBytes)
    {
        var settings = await _settings.GetAll();
        var aoEndpoint  = settings.GetValueOrDefault(SettingKeys.AzureOpenAiEndpoint, "");
        var aoKey       = settings.GetValueOrDefault(SettingKeys.AzureOpenAiKey, "");
        var aoDeployment = settings.GetValueOrDefault(SettingKeys.AzureOpenAiDeployment, "");
        var provider = settings.GetValueOrDefault(SettingKeys.AiProvider, "azure");

        if (provider != "groq" &&
            (string.IsNullOrWhiteSpace(aoEndpoint) || string.IsNullOrWhiteSpace(aoKey) || string.IsNullOrWhiteSpace(aoDeployment)))
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
            var messages = new List<object>
            {
                new { role = "user", content = prompt }
            };
            string content;
            try
            {
                content = await TEKLead.Api.Services.Llm.LlmClient.ChatAsync(_http, settings, messages, 1000);
            }
            catch (Exception ex)
            {
                return (false, $"LLM error: {ex.Message}", null);
            }

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

    /// <summary>
    /// Embedding generation — Google Gemini (gemini-embedding-001 by default), requested at
    /// 1536 output dimensions so it matches the existing pgvector column / Azure AI Search
    /// index schema with zero migration. Independent of AiProvider (chat) and VectorProvider
    /// (storage) — this is the one place embedding vectors get created, regardless of which
    /// LLM writes content or which store holds the result.
    /// </summary>
    private const int EmbeddingDimensions = 1536;

    private async Task<float[]> GenerateEmbedding(Dictionary<string, string> settings, string text)
    {
        var geminiKey      = settings.GetValueOrDefault(SettingKeys.GeminiApiKey, "").Trim();
        var geminiModelRaw = settings.GetValueOrDefault(SettingKeys.GeminiEmbeddingModel, "");
        var geminiModel    = string.IsNullOrWhiteSpace(geminiModelRaw) ? "gemini-embedding-001" : geminiModelRaw.Trim();

        if (string.IsNullOrWhiteSpace(geminiKey))
            throw new Exception("Gemini API key not configured in Settings (required for embeddings).");

        var client = _http.CreateClient();
        var url = $"https://generativelanguage.googleapis.com/v1beta/models/{geminiModel}:embedContent?key={Uri.EscapeDataString(geminiKey)}";
        var body = JsonSerializer.Serialize(new
        {
            content = new { parts = new[] { new { text } } },
            outputDimensionality = EmbeddingDimensions
        });

        var resp = await client.PostAsync(url, new StringContent(body, Encoding.UTF8, "application/json"));
        var json = await resp.Content.ReadAsStringAsync();

        if (!resp.IsSuccessStatusCode)
        {
            var keyLen = geminiKey.Length;
            var keyPreview = keyLen > 6 ? $"{geminiKey[..3]}...{geminiKey[^3..]}" : "(short)";
            var bodyPreview = string.IsNullOrEmpty(json) ? "(empty body)" : json;
            throw new Exception($"Gemini embedding error: HTTP {(int)resp.StatusCode} {resp.ReasonPhrase} | model={geminiModel} | key len={keyLen} preview={keyPreview} | body={bodyPreview}");
        }

        var doc = JsonDocument.Parse(json);
        return doc.RootElement
            .GetProperty("embedding")
            .GetProperty("values")
            .EnumerateArray()
            .Select(v => v.GetSingle())
            .ToArray();
    }

    public async Task<(bool ok, string message)> RecreateSearchIndex()
    {
        var settings = await _settings.GetAll();
        var searchEp    = settings.GetValueOrDefault(SettingKeys.AzureSearchEndpoint, "");
        var searchKey   = settings.GetValueOrDefault(SettingKeys.AzureSearchKey, "");
        var searchIndex = settings.GetValueOrDefault(SettingKeys.AzureSearchIndex, "portfolio");
        if (string.IsNullOrWhiteSpace(searchEp) || string.IsNullOrWhiteSpace(searchKey))
            return (false, "Azure Search not configured.");
        try
        {
            var client = _http.CreateClient();
            client.DefaultRequestHeaders.Add("api-key", searchKey);
            var delUrl = $"{searchEp.TrimEnd('/')}/indexes/{searchIndex}?api-version=2024-05-01-preview";
            await client.DeleteAsync(delUrl); // ignore if not exists
            await EnsureSearchIndex(searchEp, searchKey, searchIndex);
            return (true, $"Index '{searchIndex}' recreated with latest schema.");
        }
        catch (Exception ex) { return (false, ex.Message); }
    }

    private async Task EnsureSearchIndex(string endpoint, string key, string indexName)
    {
        var client = _http.CreateClient();
        client.DefaultRequestHeaders.Add("api-key", key);

        // Check if index exists
        var checkUrl = $"{endpoint.TrimEnd('/')}/indexes/{indexName}?api-version=2024-05-01-preview";
        var checkResp = await client.GetAsync(checkUrl);
        if (checkResp.IsSuccessStatusCode) return;

        // Create index - exact schema per MS docs 2024-05-01-preview
        var createUrl = $"{endpoint.TrimEnd('/')}/indexes?api-version=2024-05-01-preview";

        var indexJson = $$"""
{
  "name": "{{indexName}}",
  "fields": [
    { "name": "id",        "type": "Edm.String",             "key": true,  "searchable": false, "filterable": true,  "retrievable": true },
    { "name": "title",     "type": "Edm.String",             "key": false, "searchable": true,  "filterable": true,  "retrievable": true },
    { "name": "industry",  "type": "Edm.String",             "key": false, "searchable": true,  "filterable": true,  "retrievable": true },
    { "name": "tags",      "type": "Collection(Edm.String)", "key": false, "searchable": true,  "filterable": true,  "retrievable": true },
    { "name": "problem",   "type": "Edm.String",             "key": false, "searchable": true,  "filterable": false, "retrievable": true },
    { "name": "solution",  "type": "Edm.String",             "key": false, "searchable": true,  "filterable": false, "retrievable": true },
    { "name": "tech_stack","type": "Edm.String",             "key": false, "searchable": true,  "filterable": false, "retrievable": true },
    { "name": "outcomes",  "type": "Edm.String",             "key": false, "searchable": true,  "filterable": false, "retrievable": true },
    { "name": "links",        "type": "Edm.String", "key": false, "searchable": false, "filterable": false, "retrievable": true },
    { "name": "youtube_links", "type": "Edm.String", "key": false, "searchable": false, "filterable": false, "retrievable": true },
    {
      "name": "embedding",
      "type": "Collection(Edm.Single)",
      "searchable": true,
      "retrievable": false,
      "dimensions": 1536,
      "vectorSearchProfile": "portfolio-profile"
    }
  ],
  "vectorSearch": {
    "profiles": [
      { "name": "portfolio-profile", "algorithm": "portfolio-hnsw" }
    ],
    "algorithms": [
      { "name": "portfolio-hnsw", "kind": "hnsw" }
    ]
  }
}
""";

        var createResp = await client.PostAsync(createUrl,
            new StringContent(indexJson, Encoding.UTF8, "application/json"));
        var createJson = await createResp.Content.ReadAsStringAsync();

        if (!createResp.IsSuccessStatusCode)
            throw new Exception($"Index creation failed: {createJson}");
    }

    private async Task UploadToSearch(string endpoint, string key, string indexName, PortfolioProject p, float[] embedding)
    {
        var client = _http.CreateClient();
        client.DefaultRequestHeaders.Add("api-key", key);

        var url = $"{endpoint.TrimEnd('/')}/indexes/{indexName}/docs/index?api-version=2024-05-01-preview";

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
                    links         = p.Links,
                    youtube_links = p.YoutubeLinks,
                    embedding     = embedding
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

        var url = $"{searchEp.TrimEnd('/')}/indexes/{searchIndex}/docs/index?api-version=2024-05-01-preview";
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
        YoutubeLinks     = r.youtube_links ?? "",
        IosLink          = r.ios_link ?? "",
        AndroidLink      = r.android_link ?? "",
        WebLink          = r.web_link ?? "",
        EmbeddingIndexed = r.embedding_indexed ?? false,
        CreatedAt        = r.created_at,
    };
}
