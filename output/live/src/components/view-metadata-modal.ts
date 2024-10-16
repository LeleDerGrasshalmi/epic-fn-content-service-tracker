import * as API from "@www/api";
import { parseErrorMessage } from "@www/util/errors";

class ViewMetadataModal
{
    public modalId: string;

    public modalTitle: string;

    protected _docId: string;

    protected _$modal: JQuery = $();

    public $rootEl: JQuery = $();

    /** tracks whether the modal is in editable mode */
    public readonly canEdit$ = ko.observable(true);

    /** tracks this modal instance's error state. */
    public readonly error$ = ko.observable("");

    /** tracks this modal instance's busy state. */
    public readonly busy$ = ko.observable(false);

    /** tracks if meta editor component is rendering meta as a formatted table or raw json.*/
    public readonly view$ = ko.observable<"json" | "formatted">("formatted");

    /** hack: we can emit into this in order to force metaSource$ to be recomputed. */
    protected readonly _resetSource$ = ko.observable<number>(1);

    /** emits changes from meta-editor sub-component. */
    public readonly metaChanges$ = ko.observable<Record<string, unknown>>({});


    protected async _init(_editLabel?: string)
    {
        this._$modal = this.$rootEl.children().first();

        this.view$("formatted");
        this.error$("");
        this.busy$(false);
        this._resetSource$(performance.now());
    }

    public async show(editable: boolean)
    {
        this.canEdit$(editable);
        await this._init();
        this._$modal.modal({
            show: true,
            keyboard: false,
            backdrop: "static",
        });
    }

    public hide()
    {
        this._$modal.modal("hide");
    }
}

type MetaParentInterface = {
    busy$: KnockoutObservable<boolean>;
    getMeta(): { meta: Record<string,unknown>, docId: string }|undefined;
    setMeta(meta: Record<string,unknown>|undefined): void;
};

interface MetaComponentConfig {}

class ViewMetaModal extends ViewMetadataModal
{
    public static RegisterComponents(_config: MetaComponentConfig)
    {
        ko.components.register("view-meta-modal", {
            template: { fromUrl: `/src/components/view-metadata-modal.html` },
            viewModel: { fromContextType: ViewMetaModal },
        });
    }

    public readonly parent: MetaParentInterface;

    /** emits source meta records. */
    public readonly metaSource$ = ko.observable<Record<string, unknown>>({});

    constructor(public readonly docType: "module"|"project", parent: MetaParentInterface)
    {
        super();
        this.parent = parent;
        this.modalId = "viewMetaModal";
        this.modalTitle = "Meta";

        this.metaSource$ = ko.computed(() => {
            this._resetSource$(); // hack: including this allows us to re-trigger computation within _init.
            const info =  parent.getMeta();
            if (info)
            {
                this._docId = info.docId
                return info.meta;
            }
            return {};
        });
    }

    public async submit()
    {
        if (this.busy$())
            return;
        this.error$("");

        if (confirm("Save changes to meta?"))
        {
            try
            {
                // submit meta changes to api.
                this.busy$(true);
                let contentMeta = await API.setMetadata(this.docType, this._docId, this.metaChanges$());

                // notify parent of document changes.
                this.parent.setMeta(contentMeta);
                this.hide();
            }
            catch(e)
            {
                this.error$(parseErrorMessage(e));
            }
            finally
            {
                this.busy$(false);
            }
        }
    }

    public setView(view: "json" | "formatted")
    {
        this.view$(view);
    }
}

type SysMetaParentInterface = {
    busy$: KnockoutObservable<boolean>;
    getSysMeta(): { sysMeta: Record<string,unknown>, docId: string }|undefined;
    setSysMeta(sysMeta: Record<string,unknown>|undefined): void;
};

interface SysMetaComponentConfig {}

class ViewSysMetaModal extends ViewMetadataModal
{
    public static RegisterComponents(_config: SysMetaComponentConfig)
    {
        ko.components.register("view-sys-meta-modal", {
            template: { fromUrl: `/src/components/view-metadata-modal.html` },
            viewModel: { fromContextType: ViewSysMetaModal },
        });
    }

    public readonly parent: SysMetaParentInterface;

    /** emits source meta records. */
    public readonly metaSource$ = ko.observable<Record<string, unknown>>({});

    constructor(public readonly docType: "project"|"team", parent: SysMetaParentInterface)
    {
        super();
        this.parent = parent;
        this.modalId = "viewSysMetaModal";
        this.modalTitle = "SysMeta";

        this.metaSource$ = ko.computed(() => {
            this._resetSource$(); // hack: including this allows us to re-trigger computation within _init.
            const info =  parent.getSysMeta();
            if (info)
            {
                this._docId = info.docId
                return info.sysMeta;
            }
            return {};
        });
    }

    public async submit()
    {
        if (this.busy$())
            return;
        this.error$("");

        if (confirm("Save changes to sysMeta?"))
        {
            try
            {
                // submit meta changes to api.
                this.busy$(true);
                let contentMeta = await API.setSysMeta(this.docType, this._docId, this.metaChanges$());

                // notify parent of document changes.
                this.parent.setSysMeta(contentMeta);
                this.hide();
            }
            catch(e)
            {
                this.error$(parseErrorMessage(e));
            }
            finally
            {
                this.busy$(false);
            }
        }
    }

    public setView(view: "json" | "formatted")
    {
        this.view$(view);
    }
}

export { ViewMetaModal, ViewSysMetaModal };