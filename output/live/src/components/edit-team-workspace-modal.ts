import { WorkspaceDoc } from "@app/types";
import * as API from "@www/api";
import { parseErrorMessage } from "@www/util/errors";
import { MappedObservable, toMappedObservable } from "@www/util/ko";

type ParentInterface = {
    busy$: KnockoutObservable<boolean>;
    teamId$: KnockoutObservable<string>;
    loadAllWorkspaces(refresh?: boolean): Promise<void>
};

interface ComponentConfig
{
}

class EditTeamWorkspaceModal
{
    public static RegisterComponents(_config: ComponentConfig): void
    {
        ko.components.register("edit-team-workspacedoc-modal", {
            template: { fromUrl: `/src/components/edit-team-workspacedoc-modal.html` },
            viewModel: { fromContextType: EditTeamWorkspaceModal },
        });
    }

    public $rootEl: JQuery = $();

    protected _$modal: JQuery = $();
    protected readonly _parent: ParentInterface;

    /** tracks  info for the workspacedoc being modified. */
    public readonly target$ = ko.observable<MappedObservable<WorkspaceDoc> | null>();

    /** tracks this modal instance's error state. */
    public readonly error$ = ko.observable("");

    /** tracks this modal instance's busy state. */
    public readonly busy$ = ko.observable(false);


    // form fields
    public readonly form = {
        name$: ko.observable<string>(""),
        notes$: ko.observable<string>(""),
        parentId$: ko.observable<string>(""),
        parentOptions$: ko.observableArray<MappedObservable<WorkspaceDoc>>(),

        disableParentSelect$: ko.observable<boolean>(false),
    };

    constructor(parent: ParentInterface)
    {
        this._parent = parent;
    }

    protected _init(options: MappedObservable<WorkspaceDoc>[] = []): void
    {
        this._$modal = this.$rootEl.children().first();
        this.error$("");
        this.busy$(false);
        this.form.name$("");
        this.form.notes$("");
        this.form.parentId$("");
        this.form.disableParentSelect$(false);

        const parentOptions = options.filter(x => !x.parentId$());
        const none = toMappedObservable<WorkspaceDoc>({ workspaceId: "", name: "--no parent--", parentId: undefined, notes: undefined, owner: { type: "account", id: "" }, created: new Date(), lastPublished: undefined, creator: { type: "account", id: "" } })
        parentOptions.unshift(none);
        this.form.parentOptions$(parentOptions)
    }

    public show(target: MappedObservable<WorkspaceDoc> | null, options: MappedObservable<WorkspaceDoc>[]): void
    {
        this._init(options);
        this.target$(target);

        if (target !== null)
        {
            const unmappedTarget = target.unmap();
            this.form.name$(unmappedTarget.name);
            this.form.notes$(unmappedTarget.notes || "")
            this.form.parentId$(unmappedTarget.parentId || "");
            this.form.disableParentSelect$(true);
        }

        this._$modal.modal({
            show: true,
            keyboard: false,
            backdrop: "static",
        });
    }

    public hide(): void
    {
        this._$modal.modal("hide");
    }

    public async submit(): Promise<void>
    {
        if (this.busy$())
            return;

        this.busy$(true);
        this.error$("");

        const target = this.target$();

        const name = this.form.name$();
        const notes = this.form.notes$() || undefined;
        const workspaceId = target?.workspaceId$() || undefined;
        const parentId = target?.parentId$() || this.form.parentId$() || undefined;
        const teamId = target?.owner$().type === "account"
            ? undefined
            : target?.owner$().id || this._parent.teamId$();

        try
        {
            const rsp = workspaceId
                ? await API.updateWorkspace(workspaceId, { name, notes })
                : await API.createWorkspace({ name, notes, parentId, teamId })

            if (target)
            {
                target.name$(rsp.name);
                target.notes$(rsp.notes);
            }

            await this._parent.loadAllWorkspaces(true);
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

export default EditTeamWorkspaceModal;