using System.Text;
using System.Text.Json;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services.Llm;

/// <summary>
/// Shared chat-completion client. Routes to Azure OpenAI or Groq based on the
/// "ai_provider" setting (defaults to azure). Both APIs are OpenAI-compatible,
/// so the same messages array works for both.
/// </summary>
public static class LlmClient
{
    public static async Task<string> ChatAsync(
        IHttpClientFactory http,
        Dictionary<string, string> settings,
        List<object> messages,
        int maxTokens = 2500)
    {
        var provider = settings.GetValueOrDefault(SettingKeys.AiProvider, "azure");

        if (provider == "groq")
            return await CallGroq(http, settings, messages, maxTokens);

        return await CallAzureOpenAI(http, settings, messages, maxTokens);
    }

    private static async Task<string> CallAzureOpenAI(
        IHttpClientFactory http, Dictionary<string, string> settings, List<object> messages, int maxTokens)
    {
        var endpoint   = settings.GetValueOrDefault(SettingKeys.AzureOpenAiEndpoint, "");
        var key        = settings.GetValueOrDefault(SettingKeys.AzureOpenAiKey, "");
        var deployment = settings.GetValueOrDefault(SettingKeys.AzureOpenAiDeployment, "");

        if (string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(deployment))
            throw new Exception("Azure OpenAI not configured in Settings.");

        var client = http.CreateClient();
        client.DefaultRequestHeaders.Add("api-key", key);
        client.Timeout = TimeSpan.FromSeconds(120);

        var url = $"{endpoint.TrimEnd('/')}/openai/deployments/{deployment}/chat/completions?api-version=2024-02-01";
        var body = JsonSerializer.Serialize(new { messages, max_completion_tokens = maxTokens });

        var resp = await client.PostAsync(url, new StringContent(body, Encoding.UTF8, "application/json"));
        var json = await resp.Content.ReadAsStringAsync();

        if (!resp.IsSuccessStatusCode)
            throw new Exception($"Azure OpenAI {(int)resp.StatusCode}: {json}");

        var doc = JsonDocument.Parse(json);
        return doc.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString() ?? "";
    }

    private static async Task<string> CallGroq(
        IHttpClientFactory http, Dictionary<string, string> settings, List<object> messages, int maxTokens)
    {
        var key   = settings.GetValueOrDefault(SettingKeys.GroqApiKey, "");
        var model = settings.GetValueOrDefault(SettingKeys.GroqModel, "llama-3.3-70b-versatile");

        if (string.IsNullOrWhiteSpace(key))
            throw new Exception("Groq API key not configured in Settings.");

        var client = http.CreateClient();
        client.DefaultRequestHeaders.Add("Authorization", $"Bearer {key}");
        client.Timeout = TimeSpan.FromSeconds(120);

        const string url = "https://api.groq.com/openai/v1/chat/completions";
        // qwen3 models need reasoning_effort=none to suppress think blocks
        // openai/gpt-oss models need low/medium/high or omit entirely
        var isQwen = model.StartsWith("qwen/", StringComparison.OrdinalIgnoreCase);
        var isOpenAiOss = model.StartsWith("openai/", StringComparison.OrdinalIgnoreCase);

        object bodyObj = (isQwen, isOpenAiOss) switch
        {
            (true, _) => new { model, messages, max_tokens = maxTokens, reasoning_effort = "none" },
            (_, true) => new { model, messages, max_tokens = maxTokens },
            _         => new { model, messages, max_tokens = maxTokens },
        };

        var body = JsonSerializer.Serialize(bodyObj);

        var resp = await client.PostAsync(url, new StringContent(body, Encoding.UTF8, "application/json"));
        var json = await resp.Content.ReadAsStringAsync();

        if (!resp.IsSuccessStatusCode)
            throw new Exception($"Groq {(int)resp.StatusCode}: {json}");

        var doc = JsonDocument.Parse(json);
        return doc.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString() ?? "";
    }
}
