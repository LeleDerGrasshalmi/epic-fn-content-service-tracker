ko.components.loaders.unshift({
    loadViewModel: function(name: string, config: any, callback: (args: any) => void)
    {
        if (config.fromContextType)
        {
            // returns the previously instantiated model instance defined at params.context.
            const fromContextModelFactory = function(params: any, info: any) 
            {               
                // we expect to be given a model, of an explicit type, that has already been instantiated.
                const context = params.context; 
                if (!(params.context instanceof config.fromContextType))
                {
                    throw new Error(`ko component ${name} requires a context of type: ${config.fromType.constructor.name}, actual: ${context.constructor.name}`);
                }

                // the model expects to track the element it is bound to.
                if (info.element && context.hasOwnProperty("$rootEl"))
                {
                    context.$rootEl = $(info.element);
                }

                return context;
            }

            callback(fromContextModelFactory);
        }
        else
        {
            callback(null);
        }
    }
});