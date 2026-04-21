using Azure;
using Azure.AI.OpenAI;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class EmailAiService
{
    private readonly SettingsService _settings;
    private readonly DbService _db;

    public EmailAiService(SettingsService settings, DbService db)
    {
        _settings = settings;
        _db = db;
    }

    public async Task<(string Subject, string Body)> GenerateEmail(Lead lead, string? additionalContext, string tone)
    {
        var s = await _settings.GetSettings();
        var client = new OpenAIClient(new Uri(s.AzureOpenAiEndpoint), new AzureKeyCredential(s.AzureOpenAiKey));

        var portfolioContext = await GetPortfolioContext(client, s, lead);

        var systemPrompt = "You are an expert B2B sales copywriter. Write personalized cold outreach emails. Tone: " + tone + ". Be concise, value-focused, non-generic. Return JSON only: {\"subject\":\"...\",\"body\":\"...\"}";

        var userPrompt = "Lead: " + lead.Name + ", " + lead.Title + " at " + lead.Company + " (" + lead.Industry + ", " + lead.Location + ")\n\n"
            + "Our Relevant Work:\n" + portfolioContext + "\n\n"
            + (string.IsNullOrEmpty(additionalContext) ? "" : "Extra context: " + additionalContext + "\n\n")
            + "Write a personalized outreach email referencing our relevant experience.";

        var options = new ChatCompletionsOptions
        {
            DeploymentName = s.AzureOpenAiDeployment,
            MaxTokens = 800,
            Temperature = 0.7f,
        };
        options.Messages.Add(new ChatRequestSystemMessage(systemPrompt));
        options.Messages.Add(new ChatRequestUserMessage(userPrompt));

        var response = await client.GetChatCompletionsAsync(options);
        var raw = response.Value.Choices[0].Message.Content;

        try
        {
            var clean = raw.Trim().TrimStart('`').TrimEnd('`');
            if (clean.StartsWith("json")) clean = clean.Substring(4).Trim();
            using var doc = System.Text.Json.JsonDocument.Parse(clean);
            return (
                doc.RootElement.GetProperty("subject").GetString() ?? "",
                doc.RootElement.GetProperty("body").GetString() ?? ""
            );
        }
        catch
        {
            return ("Follow-up from TEKLead", raw);
        }
    }

    public async Task<float[]> GetEmbedding(string text)
    {
        var s = await _settings.GetSettings();
        var client = new OpenAIClient(new Uri(s.AzureOpenAiEndpoint), new AzureKeyCredential(s.AzureOpenAiKey));
        var embOptions = new EmbeddingsOptions("text-embedding-ada-002", new List<string> { text });
        var response = await client.GetEmbeddingsAsync(embOptions);
        return response.Value.Data[0].Embedding.ToArray();
    }

    private async Task<string> GetPortfolioContext(OpenAIClient client, AppSettings s, Lead lead)
    {
        try
        {
            var query = lead.Industry + " " + lead.Title + " " + lead.Company;
            var embOptions = new EmbeddingsOptions("text-embedding-ada-002", new List<string> { query });
            var embResponse = await client.GetEmbeddingsAsync(embOptions);
            var embedding = embResponse.Value.Data[0].Embedding.ToArray();

            var projects = await _db.SearchSimilarProjects(embedding, 3);
            if (projects.Count == 0) return "No portfolio data indexed yet.";

            return string.Join("\n", projects.Select(p =>
                "- " + p.Title + " (" + p.Industry + "): " + p.Solution + " | Outcomes: " + p.Outcomes));
        }
        catch
        {
            return "Portfolio search unavailable.";
        }
    }
}
