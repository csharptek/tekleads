namespace TEKLead.Api.Models;

/// <summary>
/// Each app setting is stored as one row in `app_settings` (key, value).
/// Simple, debuggable, easy to inspect via psql.
/// </summary>
public class SettingItem
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}

public static class SettingKeys
{
    public const string AzureOpenAiEndpoint     = "azure_openai_endpoint";
    public const string AzureOpenAiKey          = "azure_openai_key";
    public const string AzureOpenAiDeployment   = "azure_openai_deployment";
    public const string AzureBlobConnString     = "azure_blob_conn";
    public const string ApolloApiKey            = "apollo_api_key";

    public const string GraphTenantId           = "graph_tenant_id";
    public const string GraphClientId           = "graph_client_id";
    public const string GraphClientSecret       = "graph_client_secret";
    public const string GraphSenderEmail        = "graph_sender_email";

    public const string WhatsappCountryCode     = "whatsapp_cc";

    public static readonly string[] AllKnown =
    {
        AzureOpenAiEndpoint, AzureOpenAiKey, AzureOpenAiDeployment, AzureBlobConnString, ApolloApiKey,
        GraphTenantId, GraphClientId, GraphClientSecret, GraphSenderEmail,
        WhatsappCountryCode
    };

    /// <summary>Keys whose values are secret (returned as empty string + isSet flag).</summary>
    public static readonly HashSet<string> Secrets = new()
    {
        AzureOpenAiKey, AzureBlobConnString, ApolloApiKey, GraphClientSecret
    };
}
