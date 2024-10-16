import { TeamMembership } from "@app/types";
import * as API from "@www/api";
import { parseErrorMessage } from "@www/util/errors";
import { MappedObservable } from "@www/util/ko";

type ParentInterface = {
    busy$: KnockoutObservable<boolean>;
    hasAccess(name: "playtest" | "read" | "edit" | "operate" | "publish" | "admin", source: "membership" | "domain", target?: TeamMembership): boolean;
};

interface ComponentConfig
{
}

class EditTeamMembershipModal
{
    public static RegisterComponents(_config: ComponentConfig)
    {
        ko.components.register("edit-team-membership-modal", {
            template: { fromUrl: `/src/components/edit-team-membership-modal.html` },
            viewModel: { fromContextType: EditTeamMembershipModal },
        });
    }

    public $rootEl: JQuery = $();

    protected _$modal: JQuery = $();
    protected readonly _parent: ParentInterface;

    /** tracks membership info for the user being modified. */
    public readonly target$ = ko.observable<MappedObservable<TeamMembership>>();

    /** tracks this modal instance's error state. */
    public readonly error$ = ko.observable("");

    /** tracks this modal instance's busy state. */
    public readonly busy$ = ko.observable(false);


    // form fields
    public readonly form = {
        name$: ko.observable<string>(""),
        edit$: ko.observable<boolean>(false),
        operate$: ko.observable<boolean>(false),
        publish$: ko.observable<boolean>(false),
        admin$: ko.observable<boolean>(false),
    };

    constructor(parent: ParentInterface)
    {
        this._parent = parent;
    }

    protected async _init()
    {
        this._$modal = this.$rootEl.children().first();
        this.error$("");
        this.busy$(false);
        this.form.name$("");
        this.form.edit$(false);
        this.form.operate$(false);
        this.form.publish$(false);
        this.form.admin$(false);
    }

    public async show(target: MappedObservable<TeamMembership>)
    {
        await this._init();
        this.target$(target);

        const unmappedTarget = target.unmap();
        this.form.name$(unmappedTarget.name);
        this.form.edit$(this._parent.hasAccess("edit", "membership", unmappedTarget));
        this.form.operate$(this._parent.hasAccess("operate", "membership", unmappedTarget));
        this.form.publish$(this._parent.hasAccess("publish", "membership", unmappedTarget));
        this.form.admin$(this._parent.hasAccess("admin", "membership", unmappedTarget));
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

    public async submit()
    {
        if (this.busy$())
            return;

        this.busy$(true);
        this.error$("");

        const target = this.target$();
        if (!target)
            return;

        const name = this.form.name$();
        const access = {
            edit: this.form.edit$(),
            operate: this.form.operate$(),
            publish: this.form.publish$(),
            admin: this.form.admin$(),
        };

        try
        {
            const rsp = await API.upsertTeamMember(target.teamId$(), target.accountId$(), name, access);
            target.name$(rsp.name);
            target.access$(rsp.access);
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

export default EditTeamMembershipModal;