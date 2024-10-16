/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable no-case-declarations */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import "../js/jszip.min";

import * as API from "@www/api";
import { parseErrorMessage } from "@www/util/errors";
import { AccountInfo } from "@app/types";

import AuthUser from "@www/auth/user.model";

import { ProjectUserInfo, Inventory,  InventoryEdit, VersionedInventory, VersionedInventoryCollection, InventoryRole, InventoryType, GetInventorySetResponse } from "@app/types";
const x: Inventory = {}; x;

// configuration.
import config from "@www/config";
ko.options.deferUpdates = true;
config;

// initialize ux.
import "@www/ux/initialize";

// initialize user auth.
import "@www/auth/initialize";

// import an register async observables extention.
import "@www/util/async-extender";

// import and register custom template loader.
import "@www/util/template-loader";

// import and register custom model loader.
import "@www/util/module-loader";

import PageHeader from "@www/components/page-header/page-header";
PageHeader.RegisterComponents(config);

import InventoryEditor from "@www/components/inventory-editor/inventory-editor";
InventoryEditor.RegisterComponents(config);

import InventoryObjectViewer from "@www/components/inventory-object-viewer/inventory-object-viewer";
InventoryObjectViewer.RegisterComponents(config);

// expose API globally so we can monkey debug
(window as any).API = API;

const DEFAULT_INVENTORY_TYPE: InventoryType = "app/live";
const ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LINKCODE_REGEX = new RegExp("^\\d\\d\\d\\d-\\d\\d\\d\\d-\\d\\d\\d\\d$");

/** import/export data format */
type ExportData = {
    _exportedAt: string,
    _source: {
        projectId: string,
        playerId: string,
        type: InventoryType,
    }
    payload: Inventory
};

/** extend main view model with app specific fields and methods. */
class MainViewModel {
    /** (COMMON) tracks the number of active async tasks. */
    protected _asyncTaskCnt = 0;

    /** (COMMON) tracks authenticated user. */
    public readonly user = new AuthUser();

    /** (COMMON) shared page header. */
    public readonly pageHeader: PageHeader;

    /** (COMMON) tracks the page's busy state. */
    public readonly busy$ = ko.observable<boolean>(false);

    /** (COMMON) tracks the page's current error text. */
    public readonly error$ = ko.observable<string>("");

    /** (COMMON) refences the page's location.hashchange event delegate. */
    protected _hashChangeFn = (): Promise<void> => this._applyHashState();

    protected _exportDownloadUrl: string;

    public readonly projectInfo$ = ko.observable<ProjectUserInfo>();

    /** tracks account info streams. */
    protected accountInfos$ = new Map<string, KnockoutObservable<AccountInfo>>();

    public readonly role$ = ko.observable<InventoryRole>("player");
    public readonly playerId$ = ko.observable<string>("");
    public readonly projectId$ = ko.observable<string>("");

    public readonly canEditLive$ = ko.observable<boolean>(false);
    public readonly canEditSystem$ = ko.observable<boolean>(false);
    public readonly canEditPlaytest$ = ko.observable<boolean>(false);

    public readonly inventoryCollection$ = ko.observable<VersionedInventoryCollection>();

    public readonly editMode$ = ko.observable<boolean>(false);
    public readonly activeInventory$ = ko.observable<VersionedInventory>();
    public readonly activeInventoryType$ = ko.observable<InventoryType>(DEFAULT_INVENTORY_TYPE);

    //** this is the source inventory that should be used to seed the inventory editor (should equal what comes down from the api). */
    public readonly editorSource$ = this.activeInventory$;

    /** wired to the inventory-editor, and will start emitting changed paths as soon as a source is applied. */
    public readonly editorChanges$ = ko.observable<InventoryEdit>();

    /** wired to the inventory-editor, and will start emitting a versioned inventory containing current view (changed+unchanged) as soon as a source is applied. */
    public readonly editorCurrent$ = ko.observable<VersionedInventory>();

    /** emits true if the editor is currently emitting at least one change. */
    public readonly hasChanges$ = ko.computed<boolean>(() => {
        const changes = this.editorChanges$();
        return !!changes && Object.keys(changes).length > 0;
    });

    /** tracks the page's form field observables. */
    public readonly form = {
        getPlayerQuery$: ko.observable<string>(),
        getLinkCode$: ko.observable<string>(),
        searchMode$: ko.observable<"player"|"link">("link"),
        invTab$: ko.observable<InventoryType>("app/live"),
    };

    constructor() {
        this.pageHeader = new PageHeader(this);
        this.user.init().then(() => {
            // apply any state currently present in the hash.
            if (this.user.loggedIn$()) {
                this._applyHashState();
            } else {
                this.user.login();
            }
        });

        // any time our active player/project id's change, update our "get" form.
        this.playerId$.subscribe(id => id && this.form.getPlayerQuery$(id));
    }

    public goToProject(): void {
        const projectId = this.projectId$();
        if (!projectId)
            return;
        window.location.href = `/project/#/${encodeURIComponent(projectId)}`;
    }

    public loadInventory(projectId: string, playerId: string, activeType: InventoryType = DEFAULT_INVENTORY_TYPE): Promise<void> {
        return this._doStuff(async () => {
            this.projectId$(projectId);
            this.playerId$(playerId);

            let rsp: GetInventorySetResponse;
            try {
                rsp = await API.getInventory(projectId, playerId);
            } catch (e) {
                this.inventoryCollection$(undefined);
                this.activeInventory$(undefined);
                throw e;
            }

            this.inventoryCollection$(rsp.result.inventory);

            this.role$(rsp.role);
            this.playerId$(rsp.result.playerId);
            this.projectId$(rsp.result.projectId);

            this.setActiveInventory(activeType);

            switch(rsp.role) {
                case "admin":
                    this.canEditSystem$(true);
                    this.canEditLive$(true);
                    this.canEditPlaytest$(true);
                    break;

                case "dev":
                    this.canEditSystem$(false);
                    this.canEditLive$(true);
                    this.canEditPlaytest$(true);
                    break;

                case "player":
                    this.canEditSystem$(false);
                    this.canEditLive$(false);
                    this.canEditPlaytest$(false);
                    break;
            }

            // get project info
            this.projectInfo$(await API.getProjectUserInfo(projectId));

            $(window).off("hashchange", this._hashChangeFn);
            location.hash = `/${rsp.result.projectId}/${rsp.result.playerId}`;
            $(window).one("hashchange", this._hashChangeFn);
        });
    }

    protected async _applyHashState(): Promise<void> {

        const params = location.hash.split("/");
        $(window).off("hashchange", this._hashChangeFn);
        this.error$("");
        try {
            const project = (params[1] || "").trim();
            if (ID_REGEX.test(project)) {
                const projectId = project;
                let playerId = (params[2] || "@me").trim();

                if (playerId === "@me")
                    playerId = this.user.accountId;

                this.form.getPlayerQuery$(playerId);
                this.form.searchMode$("player");

                await this.loadInventory(projectId, playerId);
            } else if (LINKCODE_REGEX.test(project)) {
                const linkCode = project;

                this.form.getLinkCode$(linkCode);
                this.form.searchMode$("link");

                if (linkCode) {
                    const projectId = await this._getProjectFromCode(linkCode);
                    if (projectId)
                        await this.loadInventory(projectId, "@me");
                }
            } else
                window.location.hash = "";
        } finally {
            // re-apply the next time hash is changed.
            $(window).one("hashchange", this._hashChangeFn);
        }
    }

    public isInventoryLoaded(): boolean {
        return this.activeInventory$() !== undefined;
    }

    public getAccountInfos$(accountId: string): KnockoutObservable<AccountInfo> {
        if (!this.accountInfos$.has(accountId)) {
            const info$ = ko.observable<AccountInfo>({ displayName: accountId, id: "", email: "" });
            this.accountInfos$.set(accountId, info$);

            API.getAccountInfoById(accountId)
                .then(info => info$(info));
        }

        return this.accountInfos$.get(accountId)!;
    }

    public submitSearch(): Promise<void> {
        return this._doStuff(async () => {
            const playerId: string = (this.form.getPlayerQuery$() || "").trim();
            if (!playerId)
                return;

            // throws if not found
            await API.getAccountInfoById(playerId);

            if (this.form.searchMode$() === "player") {
                // load the inventory immediately
                await this.loadInventory(this.projectId$(), playerId);

                // update the hash
                $(window).off("hashchange", this._hashChangeFn);
                location.hash = `/${this.projectId$()}/${this.playerId$()}`;
                $(window).one("hashchange", this._hashChangeFn);
            } else {
                const linkCode = (this.form.getLinkCode$() || "").trim();
                const projectId = await this._getProjectFromCode(linkCode);

                // if we loaded the link code, update the hash
                $(window).off("hashchange", this._hashChangeFn);
                location.hash = `/${linkCode}`;
                $(window).one("hashchange", this._hashChangeFn);

                // now load the inventory
                await this.loadInventory(projectId, playerId);
            }
        });
    }


    private async _getProjectFromCode(linkCode: string): Promise<string> {
        if (!LINKCODE_REGEX.test(linkCode))
            throw new Error(`"${linkCode}" is not a valid link code`);

        // look up from links service. pull projectId meta value
        // TODO: in this mode we probably should also populate the link's title and tagline somewhere?
        return (await API.getIslandCodeInfo(linkCode)).projectId;
    }

    public inventoryHasData(type: InventoryType): boolean {
        const collection = this.inventoryCollection$();
        if (!collection)
            return false;

        return Object.keys(collection[type].payload).length > 0;
    }

    public setActiveInventory(type: InventoryType): void {
        const collection = this.inventoryCollection$();
        if (!collection)
            return;

        this.activeInventory$(collection[type]);
        this.activeInventoryType$(type);
        this.setEditMode(false);
    }

    public setEditMode(value: boolean): void {
        const active = this.activeInventory$();
        if (!active) {
            this.editMode$(false);
            return;
        }

        // force editor to re-initialize
        this.editorSource$(active);

        // transition to/from edit mode.
        this.editMode$(value);
    }

    public showCopyToPlaytestButton(): boolean {
        if (this.editMode$())
            return false;

        return this.activeInventoryType$() === "app/live";
    }

    public showEditInventoryButton(): boolean {
        if (this.editMode$())
            return false;

        switch (this.activeInventoryType$()) {
            case "system":
                return this.canEditSystem$();

            case "app/playtest":
                return this.canEditPlaytest$();

            case "app/live":
                return this.canEditLive$();

            case "shared/playtest":
                return this.canEditPlaytest$();

            case "shared/live":
                return this.canEditLive$();
        }
    }

    public showDeleteInventoryButton(): boolean {
        if (this.editMode$())
            return false;

        switch (this.activeInventoryType$()) {
            case "system":
                const system = this.activeInventory$() || { payload: { } };
                return (Object.keys(system.payload).length > 0) && this.canEditSystem$();

            case "app/live":
            case "app/playtest":
            case "shared/live":
            case "shared/playtest":
                return true;
        }
    }

    public copyLiveInventoryToPlaytest(): Promise<void> | undefined {
        const playerId = this.playerId$();
        const projectId = this.projectId$();
        if (!playerId || !projectId)
            return;

        if (!confirm("Replace playtest inventory with live?"))
            return;

        return this._doStuff(async () => {
            await API.copyLiveInventoryToPlaytest(projectId, playerId);
            await this.loadInventory(projectId, playerId, "app/playtest");
        });
    }

    public saveEditorChanges(): Promise<void> | undefined {
        const playerId = this.playerId$();
        const projectId = this.projectId$();
        if (!playerId || !projectId)
            return;

        const inventory = this.activeInventory$();
        const changes = this.editorChanges$();
        const type = this.activeInventoryType$();
        if (!inventory || !type || !changes)
            return;

        if (Object.keys(changes).length <= 0)
            return;

        return this._doStuff(async() => {
            if (!inventory)
                return;

            await API.updateInventory(projectId, playerId, type, inventory.baseVersion, changes);
            await this.loadInventory(projectId, playerId, type);
        });
    }

    public deleteCurrentInventory(): Promise<void> | undefined {
        const playerId = this.playerId$();
        const projectId = this.projectId$();
        const type = this.activeInventoryType$();
        if (!playerId || !projectId)
            return;

        if (!confirm(`Delete inventory: ${this.activeInventoryType$()}?`))
            return;

        return this._doStuff(async () => {
            await API.deleteInventory(projectId, playerId, type);
            await this.loadInventory(projectId, playerId, type);
        });
    }

    public exportActiveInventory(): void {
        const playerId = this.playerId$();
        const projectId = this.projectId$();
        if (!playerId || !projectId)
            return;

        const inventory = this.activeInventory$();
        if (!inventory)
            return;

        const type = this.activeInventoryType$();
        if (!type)
            return;

        const project = this.projectInfo$();
        if (!project)
            return;

        const exportData: ExportData = {
            _exportedAt: new Date().toISOString(),
            _source: {
                projectId,
                playerId,
                type,
            },
            payload: inventory.payload,
        };

        // write json string to blob.
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "text/json" });

        // create object url to blob.
        URL.revokeObjectURL(this._exportDownloadUrl);
        this._exportDownloadUrl = URL.createObjectURL(blob);

        // target a hidden <a> tag on the index page, configure and click() it invoke downloading of the blob.
        const link: HTMLAnchorElement = document.getElementById("exportInventoryDownload")! as HTMLAnchorElement;
        link.href = this._exportDownloadUrl;
        link.download = `${projectId.replaceAll("-", "")}_${playerId}_${type.replaceAll("/", "-")}.json`;
        link.click();
    }

    public importInventory(): void {
        const playerId = this.playerId$();
        const projectId = this.projectId$();
        if (!playerId || !projectId)
            return;

        const type = this.activeInventoryType$();
        if (!type)
            return;

        // capture target inventory
        const target = { playerId, type, projectId };

        // acquire .json file
        const input = document.createElement("input");
        input.setAttribute("type", "file");
        input.setAttribute("accept", ".json");

        // wire up handler for when input target file is selected.
        $(input).one("change", () => {
            if (!input.files?.[0])
                return;

            const file = input.files[0];
            const reader = new FileReader();

            reader.onload = (): void => {
                if (!reader.result)
                    throw new Error(`Failed to read json file ${file.name}.`);

                // parse source data
                const text = reader.result as string;
                let exp: ExportData;
                try {
                    exp = JSON.parse(text);
                } catch (ex) {
                    throw new Error(`Invalid json file. ${parseErrorMessage(ex)}`);
                }

                if (!exp || typeof(exp) !== "object")
                    throw new Error("Invalid json export.");

                if (!exp._source?.playerId || !exp._source.projectId || !exp._source.type)
                    throw new Error("Invalid json export (source).");

                if (!exp.payload || typeof(exp.payload) !== "object")
                    throw new Error("Invalid json export (payload).");

                // if the user is about to write a system inventory to a non-system inventory (or vice-versa), confirm intent.
                if (exp._source.type !== target.type) {
                    if (target.type === "system") {
                        if (!confirm(`You are about to overwrite a system inventory with a player inventory of type "${exp._source.type}" (this is likely a mistake).  Are you sure you want to proceed?`))
                            return;
                    }

                    if (exp._source.type === "system") {
                        if (!confirm(`You are about to overwrite a player inventory of type "${target.type}" with an exported system inventory (this is likely a mistake). Are you sure you want to proceed?`))
                            return;
                    }
                }

                // if the user is about to write an inventory that was sourced from a different project, confirm intent.
                if (exp._source.projectId !== target.projectId) {
                    if (!confirm("You are about to overwrite an inventory with data that was imported from a different project.  This project may have different expectations about what data should exist. Are you sure you want to proceed?"))
                        return;
                }

                // replace target inventory with previously exported payload.
                this._doStuff(async ()=> {
                    await API.replaceInventory(target.projectId, target.playerId, target.type, exp.payload);
                    await this.loadInventory(target.projectId, target.playerId, target.type);
                });
            };
            reader.readAsText(file);
        });

        // trigger input file select.
        $(input).trigger("click");
    }

    /** does some work while the page is kept in the busy state, errors are parsed and bubbled up to the UI. */
    protected async _doStuff<T>(stuff: () => Promise<T>): Promise<T | undefined> {
        this._asyncTaskCnt++;
        this.error$("");
        this.busy$(true);

        try {
            return await stuff();
        } catch(err) {
            this.error$(parseErrorMessage(err));
            return undefined;
        } finally {
            if (--this._asyncTaskCnt <= 0) {
                this._asyncTaskCnt = 0;
                this.busy$(false);
            }
        }
    }
}

// apply main view model to HTML template.
ko.applyBindings(new MainViewModel());