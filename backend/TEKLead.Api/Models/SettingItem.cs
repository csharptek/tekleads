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

    // Proposal Settings
    public const string ProposalCompanyName         = "proposal_company_name";
    public const string ProposalTagline             = "proposal_tagline";
    public const string ProposalWebsite             = "proposal_website";
    public const string ProposalEmail               = "proposal_email";
    public const string ProposalPhone               = "proposal_phone";
    public const string ProposalAddress             = "proposal_address";
    public const string ProposalSignerName          = "proposal_signer_name";
    public const string ProposalSignerTitle         = "proposal_signer_title";
    public const string ProposalConfidentialityText = "proposal_confidentiality_text";
    public const string ProposalFooterText          = "proposal_footer_text";
    public const string ProposalLinkedIn            = "proposal_linkedin";
    public const string ProposalYouTube             = "proposal_youtube";
    public const string ProposalGitHub              = "proposal_github";
    public const string ProposalDefaultPrompt       = "proposal_default_prompt";

    public static readonly string[] AllKnown =
    {
        AzureOpenAiEndpoint, AzureOpenAiKey, AzureOpenAiDeployment, AzureBlobConnString, ApolloApiKey,
        GraphTenantId, GraphClientId, GraphClientSecret, GraphSenderEmail,
        WhatsappCountryCode, WhatsappMessageTemplate,
        AzureSearchEndpoint, AzureSearchKey, AzureSearchIndex, AzureOpenAiEmbeddingDeployment,
        ProposalCompanyName, ProposalTagline, ProposalWebsite, ProposalEmail, ProposalPhone, ProposalAddress,
        ProposalSignerName, ProposalSignerTitle, ProposalConfidentialityText, ProposalFooterText,
        ProposalLinkedIn, ProposalYouTube, ProposalGitHub, ProposalDefaultPrompt
    };

    public static readonly HashSet<string> Secrets = new()
    {
        AzureOpenAiKey, AzureBlobConnString, ApolloApiKey, GraphClientSecret, AzureSearchKey
    };
}
