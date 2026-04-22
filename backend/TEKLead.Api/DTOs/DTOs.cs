namespace TEKLead.Api.DTOs;

public record LeadSearchRequest(
    string? Company, string? PersonName, string? JobTitle,
    string? Industry, string? Location,
    int Page = 1, int PerPage = 25
);

public record EmailGenerateRequest(string LeadId, string? AdditionalContext, string Tone = "professional");
public record EmailGenerateResponse(string Subject, string Body);
public record SendEmailRequest(string LeadId, string Subject, string Body);
public record SendWhatsAppRequest(string To, string Message);
public record RevealPhoneRequest(string ApolloPersonId);

public record UpdatePhonesRequest(string[] Phones);
