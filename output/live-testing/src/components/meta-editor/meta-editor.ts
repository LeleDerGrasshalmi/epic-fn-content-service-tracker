import { parseErrorMessage } from "@www/util/errors";

type ParentInterface = {
    busy$: KnockoutObservable<boolean>;
};

interface ComponentConfig 
{

}

interface ComponentParams
{
    parent: ParentInterface,

    busy: KnockoutObservable<boolean> | undefined,
    canEdit: KnockoutObservable<boolean> | boolean | undefined,
    view: KnockoutObservable<"json" | "formatted"> | "json" | "formatted" | undefined,

    source: KnockoutObservable<Record<string, unknown>> | Record<string, unknown> | undefined,
    changes$: KnockoutObservable<Record<string, unknown>>,
}

type MetaEntry = {
    key: string;
    type: MetaDataType;
    value: string;
}

type MetaDataType = "unknown"| "boolean" | "number" | "string" | "array" | "json";

function parseMetaEntry(entry: MetaEntry)
{
    switch (entry.type)
    {
        case "string":
            return entry.value;

        case "boolean":
            entry.value = entry.value.trim()
            if (entry.value !== "true" && entry.value !== "false")
            {
                throw new Error(`Invalid value supplied for ${entry.key} (expected boolean).`)
            }
            return JSON.parse(entry.value);

        case "number":
            const nval = parseInt(entry.value.trim());
            if (isNaN(nval))
            {
                throw new Error(`Invalid value supplied for ${entry.key} (expected number).`);
            }
            return  nval;

        case "array":
            const arrayVal = JSON.parse(entry.value.trim());
            if (!Array.isArray(arrayVal))
            {
                throw new Error(`Invalid value supplied for ${entry.key} (expected array).`);
            }
            return arrayVal;

        case "json":
            entry.value = entry.value.trim();
            if (!entry.value.startsWith("{") || !entry.value.endsWith("}"))
            {
                throw new Error(`Invalid value supplied for ${entry.key} (expected json).`);
            }
            return JSON.parse(entry.value);

        case "unknown":
            const unVal = entry.value && entry.value.trim();
            if (!unVal || unVal === "null")
            {
                // interpret "null" or falsey values as null.
                return null;
            }

            try
            {   
                // attempt to assign a parsed value (number/boolean/array/json)
                return JSON.parse(unVal);
            }
            catch
            {
                // parse failed, assign value directly (string).
                return entry.value;
            }
    }
}

class MetaEditor 
{
    public static RegisterComponents(_config: ComponentConfig)
    {
        ko.components.register("meta-editor", {
            template: { fromUrl: `/src/components/meta-editor/meta-editor.html` },
            viewModel: {
                createViewModel: function(params, info)
                {
                    return new MetaEditor(params, (<any>info));
                }
             },
        });
    }
    
    public $rootEl: JQuery;
    protected readonly _parent: ParentInterface;    

    // tracks component instance's busy state.
    public readonly busy$ = ko.observable(false);

    // tracks this component instance's error state.
    public readonly error$ = ko.observable("");

    // tracks if the current user can make changes via this component.
    public readonly canEdit$ = ko.observable(false);

    // unique identifier for this component instance.
    public readonly componentId = performance.now();

    /** tracks if component is rendering meta as a formatted table or raw json.*/
    public readonly view$ = ko.observable<"json" | "formatted">("formatted");

    // emits the source META rendered by this editor.
    protected readonly _source$ = ko.observable<Record<string, unknown>>();

    // computes the current META values for this editor.
    protected readonly _changes$ = ko.observable<Record<string, unknown>>({});

    // form fields
    public readonly form = {
        meta$ :ko.observable<Record<string, unknown>>({}),
        metaJson$: ko.observable<string>("{}"),
        metaEntries$: ko.computed<MetaEntry[]>(() => []),
    };

    constructor(params: ComponentParams, rootEl: Node)
    {
        this._parent = params.parent;
        this.$rootEl = $(rootEl as HTMLElement);        
        
        if (params.busy)
            this.busy$ = params.busy;    
        
        if (params.canEdit != undefined)
        {
            if (typeof(params.canEdit) === "boolean")
                this.canEdit$ = ko.observable(params.canEdit);
            else
                this.canEdit$ = params.canEdit;
        }

        if (params.source !== undefined)
        {
            if (typeof(params.source) === "object")
                this._source$(params.source);
            else
                this._source$ = params.source;        
        }
        else
        {
            this._source$({});
        }

        if (params.view !== undefined)
        {
            if (typeof(params.view) === "string")
                this.view$(params.view);
            else
                this.view$ = params.view;
        }
        
        this.form.metaEntries$ = ko.computed<MetaEntry[]>(() => this._buildMetaEntries());
        
        this._changes$ = ko.computed<Record<string, unknown>>(() => this._computeChanges());

        if (params.changes$)
        {
            // whenever we have changes, we need to emit the new value up into our parent's result observable.
            this._changes$.subscribe(newVal => params.changes$(newVal));
        }

        this._init();

        // whenever a view change is emitted by our parent we need to handle it.
        this.view$.subscribe(view => this._onViewChange(view));

        this.form.metaEntries$.subscribe(x => {
            console.log(JSON.stringify(x));
        });

        // whenever our source changes, re-initialize.
        this._source$.subscribe(() => this._init());
    }

    protected async _init()
    {
        if (this.form.metaEntries$().length > 0)
        {
            this.view$("formatted");
        }
        else
        {
            this.view$("json");
        }

        const source = this._source$()
        if (!source)
            return this.error$("Source Meta Not Set.");

        this.form.meta$({ ...source });
        this.form.metaJson$(JSON.stringify(source, null, 2));

        // TODO: Default Title, Description for Projects.

        this.error$("");
        this.busy$(false);
    }

    public onEntryChange()
    {
        // write parsed entry values back to document.
        let newMeta : Record<string,unknown> = {};
        for (const entry of this.form.metaEntries$())
            newMeta[entry.key] = parseMetaEntry(entry);

        this.form.meta$(newMeta);
    }

    protected _computeChanges()
    {
        const source = this._source$() || {};

        if (this.view$() === "json")
        {
            const currentJson = JSON.stringify(this.form.meta$());
            const newJson = JSON.stringify(JSON.parse(this.form.metaJson$()));
            if (newJson !== currentJson)
            {
                // attempt to parse the current metaJson back into the meta object.
                // * this will make sure metaEntries$ values are up-to-date for the next step.
                this.form.meta$(JSON.parse(this.form.metaJson$()));
            }
        }

        // write parsed entry values back to document.
        let newMeta : Record<string,unknown> = {};
        for (const entry of this.form.metaEntries$())
            newMeta[entry.key] = parseMetaEntry(entry);
        
        // keys that have been deleted should be represented by <null>.
        for (const key in source)
        {
            if (newMeta[key] === undefined)
                newMeta[key] = null; // use null to indicate deletion
        }

        // remove unmodified keys from the changeset. 
        for (const key of Object.keys(newMeta))
        {
            if (newMeta[key] === source[key])
                delete newMeta[key];
        }

        return newMeta;        
    }

    protected _buildMetaEntries()
    {
        const meta = this.form.meta$();
        const result: MetaEntry[] = [];
        for (const key of Object.keys(meta))
        {
            let type: MetaDataType | undefined = undefined;
            let value = meta[key]

            if (value === null)
            {
                type = "unknown"
            }
            else if (typeof value === "boolean")
            {
                type = "boolean";
            }
            else if (typeof value === "string")
            {
                type = "string"
            }
            else if (typeof value === "number")
            {
                type = "number"
            }
            else if (Array.isArray(value))
            {
                type = "array";
            }
            else if (typeof value === "object")
            {
                type = "json";
            }

            if (!type)
            {
                // unsupported (skip).
                console.warn(`meta viewer encountered unrecognized pair ${key}: ${value}`);
                continue;
            }

            if (type === "unknown" || type === "array" || type === "json")
                result.push({ key, type, value: JSON.stringify(value) });
            else
                result.push({ key, type, value: (<any>value).toString()});
        }  

        return result;
    }

    protected _onViewChange(view: "json" | "formatted")
    {
        if (view === "json")
        {
            this.error$("");

            // build pending entries list back into a proper object.
            const meta: Record<string, unknown> = {};
            for (const entry of this.form.metaEntries$())
            {
                try
                {
                    meta[entry.key] = parseMetaEntry(entry);
                }
                catch (err)
                {
                    // surface the error and skip this entry
                    this.error$(this.error$() + "\n" + parseErrorMessage(err));
                    meta[entry.key] = entry.value;
                }
            }

            // push the object into the JSON editor (this syncs any unsaved changes).
            this.form.metaJson$(JSON.stringify(meta, null, 2));
        }
        else
        {
            try
            {
                // attempt to parse the current metaJson back into the meta object.
                this.form.meta$(JSON.parse(this.form.metaJson$()));

                // if it succeeded, proceed with view change.
                this.error$("");
            }
            catch (e)
            {
                this.error$(parseErrorMessage(e));
            }
        }
    }
}

export default MetaEditor;