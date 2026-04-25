namespace TEKLead.Api.Models;

public class SettingItem
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}

public static class SettingKeys
{
    public const string AzureOpenAiEndpoint        = "azure_openai_endpoint";
    public const string AzureOpenAiKey             = "azure_openai_key";
    public const string AzureOpenAiDeployment      = "azure_openai_deployment";
    public const string AzureBlobConnString        = "azure_blob_conn";
    public const string ApolloApiKey               = "apollo_api_key";

    public const string GraphTenantId              = "graph_tenant_id";
    public const string GraphClientId              = "graph_client_id";
    public const string GraphClientSecret          = "graph_client_secret";
    public const string GraphSenderEmail           = "graph_sender_email";

    public const string WhatsappCountryCode        = "whatsapp_cc";
    public const string WhatsappMessageTemplate    = "whatsapp_message_template";

    public const string AzureSearchEndpoint        = "azure_search_endpoint";
    public const string AzureSearchKey             = "azure_search_key";
    public const string AzureSearchIndex           = "azure_search_index";
    public const string AzureOpenAiEmbeddingDeployment = "azure_openai_embedding_deployment";

    public static readonly string[] AllKnown =
    {
        AzureOpenAiEndpoint, AzureOpenAiKey, AzureOpenAiDeployment, AzureBlobConnString, ApolloApiKey,
        GraphTenantId, GraphClientId, GraphClientSecret, GraphSenderEmail,
        WhatsappCountryCode, WhatsappMessageTemplate,
        AzureSearchEndpoint, AzureSearchKey, AzureSearchIndex, AzureOpenAiEmbeddingDeployment
    };

    public static readonly HashSet<string> Secrets = new()
    {
        AzureOpenAiKey, AzureBlobConnString, ApolloApiKey, GraphClientSecret, AzureSearchKey
    };
}
