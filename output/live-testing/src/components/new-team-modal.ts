import * as API from "@www/api";
import { parseErrorMessage } from "@www/util/errors";

import { TeamDoc } from "@app/types";

type ParentInterface = {
    busy$: KnockoutObservable<boolean>;
    openTeam(projectId: string): void;
};

interface ComponentConfig
{
}

class NewTeamModal
{
    public static RegisterComponents(_config: ComponentConfig)
    {
        ko.components.register("new-team-modal", {
            template: { fromUrl: `/src/components/new-team-modal.html` },
            viewModel: { fromContextType: NewTeamModal },
        });
    }

    public $rootEl: JQuery = $();

    protected _$modal: JQuery = $();
    protected readonly _parent: ParentInterface;

    /** tracks this modal instance's error state. */
    public readonly error$ = ko.observable("");

    /** tracks this modal instance's busy state. */
    public readonly busy$ = ko.observable(false);

    /** tracks what team is being editted (if applicable) */
    public readonly team$ = ko.observable<TeamDoc | null>(null);

    // form fields
    public readonly form = {
        name$: ko.observable<string>(""),
        description$: ko.observable<string>(""),
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
        this.team$(null);
        this.form.name$("");
        this.form.description$("");
    }

    public async show(team?: TeamDoc)
    {
        await this._init();
        if (!!team)
        {
            this.team$(team);
            this.form.name$(team.publicProps.name);
            this.form.description$(team.publicProps.description);
        }
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

        const name = this.form.name$() || "";
        if (!name)
        {
            if (!confirm("Team name is required."))
                return;
        }

        const description = this.form.description$() || "";

        this.busy$(true);
        this.error$("");
        try
        {
            const team = this.team$();
            if (!!team)
            {
                // edit mode
                await API.editTeamProperties(team.teamId, { ...team.publicProps, name, description  });
                window.location.reload();
            }
            else
            {
                const rsp = await API.createTeam({ name, description, emailDomains: [] });
                this._parent.openTeam(rsp.teamId);
            }

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

export default NewTeamModal;