import { VersionedInventory } from "@app/types";

import { FInventory } from "./cpp/inventory";
import { ApplyUpdateToInventory } from "./cpp/sidecar-inventory";

type ParentInterface = {
    busy$: KnockoutObservable<boolean>;
};

interface ComponentConfig
{

}

interface ComponentParams
{
    parent: ParentInterface;
    source: KnockoutObservable<VersionedInventory>;
}

// tracks the number of viewer instances (for uniqueId purposes)
let instanceCount: number = 0;

class InventoryObjectViewer
{
    public static RegisterComponents(_config: ComponentConfig)
    {
        ko.components.register("inventory-object-viewer", {
            template: { fromUrl: `/src/components/inventory-object-viewer/inventory-object-viewer.html` },
            viewModel: {
                createViewModel: function(params, info)
                {
                    return new InventoryObjectViewer(params, (<any>info));
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

    // unique inventory object viewer html id.
    public readonly id$ = ko.observable(`inventory-object-viewer_${++instanceCount}`);

    // emits the source inventory rendered by this component.
    protected readonly source$ = ko.observable<VersionedInventory>();

    // form fields
    public readonly form = {

    };

    constructor(params: ComponentParams, rootEl: Node)
    {
        this._parent = params.parent;
        this.$rootEl = $(rootEl as HTMLElement);

        if (params.source !== undefined)
        {
            if (typeof(params.source) === "object")
                this.source$(params.source);
            else
                this.source$ = params.source;
        }

        // whenever our source changes, re-initialize.
        this.source$.subscribe(() => this._init());
    }

    protected _buildObjectView(source: VersionedInventory)
    {
        var inventory = new FInventory();
        ApplyUpdateToInventory(inventory, source.payload);
        const result = inventory.rootItem.constructDocument();
        return result;
    }

    protected async _init()
    {
        const source = this.source$()
        if (!source)
            return this.error$("Source inventory not set.");

        var objectView = this._buildObjectView(source);
        (<any>$(`#${this.id$()}`)).jsonViewer(objectView, {
            collapsed: false,            // all nodes collapsed by default
            rootCollapsable: false,     // don't allow root element to be collapsed
            withQuotes: false,          // don't wrap object keys with quotes
            withLinks: true,            // values that are valid links will be clickable.
        });

        this.error$("");
        this.busy$(false);
    }
}

export default InventoryObjectViewer;