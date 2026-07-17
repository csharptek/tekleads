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
    public const string ApolloMasterKey            = "apollo_master_key";

    public const string GraphTenantId              = "graph_tenant_id";
    public const string GraphClientId              = "graph_client_id";
    public const string GraphClientSecret          = "graph_client_secret";
    public const string GraphSenderEmail           = "graph_sender_email";

    public const string WhatsappCountryCode        = "whatsapp_cc";
    public const string WhatsappMessageTemplate    = "whatsapp_message_template";

    // WhatsApp Business Cloud API (Meta)
    public const string WhatsappCloudPhoneNumberId = "whatsapp_cloud_phone_number_id";
    public const string WhatsappCloudWabaId        = "whatsapp_cloud_waba_id";
    public const string WhatsappCloudAccessToken   = "whatsapp_cloud_access_token";
    public const string WhatsappCloudVerifyToken   = "whatsapp_cloud_verify_token";
    public const string WhatsappCloudTemplateName  = "whatsapp_cloud_template_name";
    public const string WhatsappCloudTemplateLang  = "whatsapp_cloud_template_lang";
    public const string WhatsappCloudApiVersion    = "whatsapp_cloud_api_version";
    public const string WhatsappBlobContainer      = "whatsapp_blob_container";

    public const string AzureSearchEndpoint        = "azure_search_endpoint";
    public const string AzureSearchKey             = "azure_search_key";
    public const string AzureSearchIndex           = "azure_search_index";
    public const string AzureOpenAiEmbeddingDeployment = "azure_openai_embedding_deployment";

    // LLM provider toggle
    public const string AiProvider                 = "ai_provider";          // "azure" | "groq" | "claude"
    public const string GroqApiKey                 = "groq_api_key";
    public const string GroqModel                  = "groq_model";
    public const string ClaudeApiKey               = "claude_api_key";
    public const string ClaudeModel                = "claude_model";

    // Vector store toggle
    public const string VectorProvider             = "vector_provider";      // "azure_search" | "pgvector"

    // Provider-specific artifact prompts
    public const string ArtifactCoverLetterPromptAzure = "artifact_cover_letter_prompt_azure";
    public const string ArtifactWhatsappPromptAzure    = "artifact_whatsapp_prompt_azure";
    public const string ArtifactEmailPromptAzure       = "artifact_email_prompt_azure";
    public const string ArtifactFollowUp1PromptAzure   = "artifact_followup1_prompt_azure";
    public const string ArtifactFollowUp2PromptAzure   = "artifact_followup2_prompt_azure";
    public const string ArtifactCoverLetterPromptGroq  = "artifact_cover_letter_prompt_groq";
    public const string ArtifactWhatsappPromptGroq     = "artifact_whatsapp_prompt_groq";
    public const string ArtifactEmailPromptGroq        = "artifact_email_prompt_groq";
    public const string ArtifactFollowUp1PromptGroq    = "artifact_followup1_prompt_groq";
    public const string ArtifactFollowUp2PromptGroq    = "artifact_followup2_prompt_groq";

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

    public const string EmailSignature              = "email_signature";

    // App
    public const string AppUrl                      = "app_url";

    // Instantly
    public const string InstantlyApiKey             = "instantly_api_key";

    // Artifact Prompts
    public const string ArtifactCoverLetterPrompt   = "artifact_cover_letter_prompt";
    public const string ArtifactWhatsappPrompt      = "artifact_whatsapp_prompt";
    public const string ArtifactEmailPrompt         = "artifact_email_prompt";
    public const string ArtifactFollowUp1Prompt     = "artifact_followup1_prompt";
    public const string ArtifactFollowUp2Prompt     = "artifact_followup2_prompt";

    public const string PhoneWebhookWorkerEnabled = "phone_webhook_worker_enabled";
    public const string WaSendEnabled               = "wa_send_enabled";
    public const string WaSendIntervalSeconds       = "wa_send_interval_seconds";

    public const string ApifyApiKey                = "apify_api_key";
    public const string JobScraperKeywords         = "job_scraper_keywords";
    public const string EmailSendersJson           = "email_senders_json";

    // Job Lead artifact prompts
    public const string JobLeadEmailPrompt         = "job_lead_email_prompt";
    public const string JobLeadFollowUp1Prompt     = "job_lead_followup1_prompt";
    public const string JobLeadFollowUp2Prompt     = "job_lead_followup2_prompt";

    public static readonly string[] AllKnown =
    {
        AzureOpenAiEndpoint, AzureOpenAiKey, AzureOpenAiDeployment, AzureBlobConnString, ApolloApiKey,
        GraphTenantId, GraphClientId, GraphClientSecret, GraphSenderEmail,
        WhatsappCountryCode, WhatsappMessageTemplate,
        WhatsappCloudPhoneNumberId, WhatsappCloudWabaId, WhatsappCloudAccessToken, WhatsappCloudVerifyToken,
        WhatsappCloudTemplateName, WhatsappCloudTemplateLang, WhatsappCloudApiVersion, WhatsappBlobContainer,
        AzureSearchEndpoint, AzureSearchKey, AzureSearchIndex, AzureOpenAiEmbeddingDeployment,
        AiProvider, GroqApiKey, GroqModel, ClaudeApiKey, ClaudeModel, VectorProvider,
        ArtifactCoverLetterPromptAzure, ArtifactWhatsappPromptAzure, ArtifactEmailPromptAzure, ArtifactFollowUp1PromptAzure, ArtifactFollowUp2PromptAzure,
        ArtifactCoverLetterPromptGroq,  ArtifactWhatsappPromptGroq,  ArtifactEmailPromptGroq,  ArtifactFollowUp1PromptGroq,  ArtifactFollowUp2PromptGroq,
        ProposalCompanyName, ProposalTagline, ProposalWebsite, ProposalEmail, ProposalPhone, ProposalAddress,
        ProposalSignerName, ProposalSignerTitle, ProposalConfidentialityText, ProposalFooterText,
        ProposalLinkedIn, ProposalYouTube, ProposalGitHub, ProposalDefaultPrompt,
        AppUrl, ApolloMasterKey, EmailSignature, InstantlyApiKey,
        ArtifactCoverLetterPrompt, ArtifactWhatsappPrompt, ArtifactEmailPrompt,
        ArtifactFollowUp1Prompt, ArtifactFollowUp2Prompt,
        PhoneWebhookWorkerEnabled,
        WaSendEnabled,
        WaSendIntervalSeconds,
        ApifyApiKey, JobScraperKeywords, EmailSendersJson,
        JobLeadEmailPrompt, JobLeadFollowUp1Prompt, JobLeadFollowUp2Prompt,
    };

    public static readonly HashSet<string> Secrets = new()
    {
        AzureOpenAiKey, AzureBlobConnString, ApolloApiKey, GraphClientSecret, AzureSearchKey, InstantlyApiKey,
        WhatsappCloudAccessToken, WhatsappCloudVerifyToken, ApolloMasterKey, GroqApiKey, ClaudeApiKey, ApifyApiKey
    };
}
