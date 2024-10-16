/// <reference path="../../../js/jsonic.d.ts" />
import { Inventory, VersionedInventory, InventoryValue, InventoryEdit } from "@app/types";

import { isLegalItemPath } from "./fn/is-legal-item-path";

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
    current: KnockoutObservable<VersionedInventory>;
    changes: KnockoutObservable<InventoryEdit>;
}

interface DataRow
{
    path: string;
    value: InventoryValue;
    valueString: string;

    _isEdit: boolean;
    _isRemoved: boolean;
    _isNew: boolean;

    _sourceValue?: InventoryValue;
}

function cloneDeep<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
}

function deepEqual(a: any, b: any)
{
    return JSON.stringify(a) === JSON.stringify(b);
}

function parse<T>(json: string): T
{
    return jsonic(json);
}

function stringify<T>(obj: T): string
{
    return JSON.stringify(obj);
}

// tracks the number of viewer instances (for uniqueId purposes)
let instanceCount: number = 0;

class InventoryEditor
{
    public static RegisterComponents(_config: ComponentConfig)
    {
        ko.components.register("inventory-editor", {
            template: { fromUrl: `/src/components/inventory-editor/inventory-editor.html` },
            viewModel: {
                createViewModel: function(params, info)
                {
                    return new InventoryEditor(params, (<any>info));
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
    public readonly id$ = ko.observable(`inventory-editor_${++instanceCount}`);

    // emits the source inventory rendered by this component.
    protected readonly source$ = ko.observable<VersionedInventory>();

    // emits a complete versioned inventory with both changed and unchanged values.
    protected readonly current$ = ko.observable<VersionedInventory>();

    // emits inventory data that has been modified by this editor.
    protected readonly changes$ = ko.observable<InventoryEdit>();

    // emits an array of data rows used to power this editor.
    public readonly dataRows$ = ko.observable<DataRow[]>([]);

    public readonly form = {
        newRowPath$: ko.observable<string>(),
        newRowValueStr$: ko.observable<string>(),
    };

    constructor(params: ComponentParams, rootEl: Node)
    {
        this._parent = params.parent;
        this.$rootEl = $(rootEl as HTMLElement);

        if (typeof params.source !== "function")
            throw new Error("Inventory editor source should be a ko.observable");

        if (typeof params.changes !== "function")
            throw new Error("Inventory editor changes should be a ko.observable");

        if (typeof params.current !== "function")
            throw new Error("Inventory editor current should be a ko.observable");

        this.source$ = params.source;
        this.changes$ = params.changes;
        this.current$ = params.current;

        // whenever our source changes, re-initialize.
        this.source$.subscribe(() => this._init());
    }

    protected async _init()
    {
        const source = this.source$()
        if (!source)
            return this.error$("Source inventory not set.");

        // build data row set.
        const rows: DataRow[] = [];
        for(const path of Object.keys(source.payload).sort())
        {
            const value = source.payload[path];
            rows.push({
                path,
                value,
                valueString: stringify(value),
                _isNew: false,
                _isEdit: false,
                _isRemoved: false,
                _sourceValue: value,
            });
        }
        this.dataRows$(rows);

        // initialize changes
        this.changes$({});

        // initialize current state
        this.current$({
            baseVersion: source.baseVersion,
            payload: cloneDeep(source.payload),
        });

        this.error$("");
        this.busy$(false);
    }

    public forceDataRowUIChanges()
    {
        // HACK: deep-copy to get KO to acknowledge selector reference changes.
        const changes = cloneDeep(this.dataRows$());
        this.dataRows$(changes);
    }

    protected _parseValueString(valueString: string): InventoryValue
    {
        // normalize possible boolean value (e.g. True, TRUE, TrUe)
        if (valueString.localeCompare("true", undefined, { sensitivity: "base" }) === 0)
            valueString = "true";

        // normalize possible boolean value (e.g. False, FALSE, FaLsE)
        if (valueString.localeCompare("false", undefined, { sensitivity: "base" }) === 0)
            valueString = "false";

        try
        {   // try to parse the new valueString
            // note: this will succeed for valid json objects, numbers or normalized boolean values.
            return parse(valueString);
        }
        catch
        {
            // parse failed, treat new value as a string.
            return valueString;
        }
    }

    public onDataRowChanged(changedRow: DataRow)
    {
        // ensure we have a previous value (before applying valueString changes)
        if (changedRow._sourceValue === undefined)
            throw new Error("Source value undefined.");

        // resolve new value from modified valueString
        changedRow.value = this._parseValueString(changedRow.valueString);

        // normalize any formatting that was added to the valueString during this edit
        changedRow.valueString = stringify(changedRow.value);

        // we need to compute whether or not this row should be considered "dirty"
        const isDirty = changedRow._isRemoved
            ||changedRow._isNew
            ||!deepEqual(changedRow.value, changedRow._sourceValue);

        // emit changes
        const changes = this.changes$();
        if (!changes)
            throw new Error("Changeset not initialized.");

        if (isDirty)
        {
            if (changedRow._isRemoved)
            {
                if (changedRow._isNew)
                {
                    // removed rows that did not exist previously should not be reflectd in changeset.
                    delete changes[changedRow.path];
                }
                else
                {
                    // removed rows that previously existed are reprented by NULL.
                    changes[changedRow.path] = null;
                }
            }
            else
            {
                // row should be reflected in changeset.
                changes[changedRow.path] = changedRow.value;
            }
        }
        else
        {
            // ensure row is not reflected in changeset.
            delete changes[changedRow.path];
        }
        this.changes$(changes);

        // merge changes into source to produce and new current state
        const source = this.source$();
        if (!source)
            throw new Error("Source not initialized.");

        const state = this.current$();
        if (!state)
            throw new Error("State not initialized.");

        const current = cloneDeep<Inventory>(<any>{...source.payload, ...changes });

        // we want to remove "NULL" values from the current view b/c these represent deleted rows.
        for (const [path, value] of Object.entries(current))
        {
            if (value === null)
                delete current[path];
        }

        this.current$({
            baseVersion: source.baseVersion,
            payload: current,
        });

        this.forceDataRowUIChanges();
    }

    public setEditRow(row: DataRow)
    {
        row._isEdit = true;
        row._isRemoved = false;
        this.onDataRowChanged(row);
    }

    public setRemoveRow(row: DataRow)
    {
        if (row._isNew)
        {
            // new rows just get removed
            const rows = this.dataRows$();
            const idx = rows.indexOf(row);
            rows.splice(idx, 1);
            this.dataRows$(rows);
        }

        row._isEdit = false;
        row._isRemoved = true;
        this.onDataRowChanged(row);
    }

    public revertRow(row: DataRow)
    {
        row._isEdit = false;
        row._isRemoved = false;
        row.value = row._sourceValue!;
        row.valueString = stringify(row.value);
        this.onDataRowChanged(row);
    }

    public addRow(path: string, valueString: string)
    {
        if (!path || !valueString)
            return;

        // normalize lower case.
        path = path.toLowerCase().trim();

        // remove root slash (if present).
        while (path.startsWith("/"))
            path = path.substring(1);

        // update form with normalizations in case there are errors (user can figure it out).
        this.form.newRowPath$(path);

        if (path.indexOf("//") !== -1)
            return alert("illegal item path: '//' not allowed");

        for (const segment of path.split("/"))
        {
            if (!isLegalItemPath(segment, false))
                return alert(`illegal path segment: ${segment}`);
        }

        const value = this._parseValueString(valueString);
        const newRow: DataRow = {
            path: `/${path}`,
            value,
            valueString,
            _isNew: true,
            _isEdit: false,
            _isRemoved: false,
            _sourceValue: value,
        };

        const existingRows = this.dataRows$();
        this.dataRows$([...existingRows, newRow]);
        this.onDataRowChanged(newRow);

        this.form.newRowPath$("");
        this.form.newRowValueStr$("");

        setTimeout(() => {
            var el = document.getElementById(`${this.id$()}_new_path`);
            el?.scrollIntoView({ behavior: "auto"});
            el?.focus();
        });
    }
}

export default InventoryEditor;