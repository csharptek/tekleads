using Microsoft.Azure.Cosmos;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class CosmosService
{
    private CosmosClient? _client;
    private Database? _db;
    private Container? _container;
    private readonly SettingsService _settingsService;

    public CosmosService(SettingsService settingsService)
    {
        _settingsService = settingsService;
    }

    private async Task<Container> GetContainer()
    {
        if (_container != null) return _container;

        var settings = await _settingsService.GetSettings();
        _client = new CosmosClient(settings.CosmosDbConnectionString);
        _db = await _client.CreateDatabaseIfNotExistsAsync(settings.CosmosDbDatabase);
        var response = await _db.CreateContainerIfNotExistsAsync("items", "/type");
        _container = response.Container;
        return _container;
    }

    public async Task<T> UpsertAsync<T>(T item) where T : class
    {
        var container = await GetContainer();
        var response = await container.UpsertItemAsync(item);
        return response.Resource;
    }

    public async Task<List<T>> QueryAsync<T>(string query)
    {
        var container = await GetContainer();
        var results = new List<T>();
        var iterator = container.GetItemQueryIterator<T>(new QueryDefinition(query));
        while (iterator.HasMoreResults)
        {
            var page = await iterator.ReadNextAsync();
            results.AddRange(page);
        }
        return results;
    }

    public async Task DeleteAsync(string id, string type)
    {
        var container = await GetContainer();
        await container.DeleteItemAsync<dynamic>(id, new PartitionKey(type));
    }

    public async Task<T?> GetByIdAsync<T>(string id, string type)
    {
        try
        {
            var container = await GetContainer();
            var response = await container.ReadItemAsync<T>(id, new PartitionKey(type));
            return response.Resource;
        }
        catch (CosmosException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return default;
        }
    }
}
