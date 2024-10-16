import { EmailDomain, TeamDoc } from "@app/types";
import * as API from "@www/api";
import { parseErrorMessage } from "@www/util/errors";

type ParentInterface = {
    busy$: KnockoutObservable<boolean>;
    hasAccess(name: "playtest" | "read" | "edit" | "operate" | "publish" | "admin", source: "membership" | "domain", target?: EmailDomain): boolean;
};

interface ComponentConfig
{
}

class EditTeamDomainModal
{
    public static RegisterComponents(_config: ComponentConfig)
    {
        ko.components.register("edit-team-domain-modal", {
            template: { fromUrl: `/src/components/edit-team-domain-modal.html` },
            viewModel: { fromContextType: EditTeamDomainModal },
        });
    }

    public $rootEl: JQuery = $();

    protected _$modal: JQuery = $();
    protected readonly _parent: ParentInterface;

    /** tracks the team being modified */
    public readonly team$ = ko.observable<TeamDoc>();

    /** tracks domain info being modified. */
    public readonly target$ = ko.observable<EmailDomain>();

    /** tracks this modal instance's error state. */
    public readonly error$ = ko.observable("");

    /** tracks this modal instance's busy state. */
    public readonly busy$ = ko.observable(false);

    // form fields
    public readonly form = {
        domain$: ko.observable<string>(""),
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
        this.team$(undefined);
        this.form.domain$("");
        this.form.edit$(false);
        this.form.operate$(false);
        this.form.publish$(false);
        this.form.admin$(false);
    }

    public async show(team: TeamDoc, target: EmailDomain)
    {
        await this._init();
        this.team$(team);
        this.target$(target);

        this.form.domain$(target.domain);
        this.form.edit$(this._parent.hasAccess("edit", "domain", target));
        this.form.operate$(this._parent.hasAccess("operate", "domain", target));
        this.form.publish$(this._parent.hasAccess("publish", "domain", target));
        this.form.admin$(this._parent.hasAccess("admin", "domain", target));
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

        const team = this.team$();
        if (!team)
            return;

        const target = this.target$();
        if (!target)
            return;

        const domain = this.form.domain$();
        const access = {
            edit: this.form.edit$(),
            operate: this.form.operate$(),
            publish: this.form.publish$(),
            admin: this.form.admin$(),
        };

        const idx = team.publicProps.emailDomains.findIndex(d => d.domain === target.domain);
        const emailDomains = team.publicProps.emailDomains.filter(d => d.domain !== target.domain);
        emailDomains.splice(Math.max(idx, 0), 0, { domain, access });

        try
        {
            await API.editTeamProperties(team.teamId, { ...team.publicProps, emailDomains });
            this.hide();
            window.location.reload();
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

export default EditTeamDomainModal;