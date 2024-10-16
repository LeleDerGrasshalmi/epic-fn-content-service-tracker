ko.components.loaders.unshift({
    loadTemplate: function(name: string, config: any, callback: (args: Node[] | null) => void )
    {
        if (config.fromUrl)
        {
            $.get(config.fromUrl, (template) => {
                ko.components.defaultLoader.loadTemplate!(name, template, callback);
            });
        }
        else
        {
            callback(null);
        }
    }
});