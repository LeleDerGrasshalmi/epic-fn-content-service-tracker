/* eslint-disable @typescript-eslint/explicit-function-return-type */
import * as API from "@www/api";
import { parseErrorMessage } from "@www/util/errors";

const ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type ParentInterface = {
    busy$: KnockoutObservable<boolean>;
    openProject(projectId: string): void;
};

interface ComponentConfig
{
}

class NewProjectModal
{
    public static RegisterComponents(_config: ComponentConfig)
    {
        ko.components.register("new-project-modal", {
            template: { fromUrl: `/src/components/new-project-modal.html` },
            viewModel: { fromContextType: NewProjectModal },
        });
    }

    public $rootEl: JQuery = $();

    protected _$modal: JQuery = $();
    protected readonly _parent: ParentInterface;

    /** tracks this modal instance's error state. */
    public readonly error$ = ko.observable("");

    /** tracks this modal instance's busy state. */
    public readonly busy$ = ko.observable(false);


    // form fields
    public readonly form = {
        desiredProjectId$: ko.observable<string>(),
        title$: ko.observable<string>(""),
        description$: ko.observable<string>(""),
    };

    constructor(parent: ParentInterface)
    {
        this._parent = parent;
    }

    protected _init()
    {
        this._$modal = this.$rootEl.children().first();
        this.error$("");
        this.busy$(false);
        this.form.title$("");
        this.form.description$("");
    }

    public show()
    {
        this._init();
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

        let desiredProjectId = this.form.desiredProjectId$()?.trim();
        if (!desiredProjectId)
        {
            // don't pass it up at all if blank
            desiredProjectId = undefined;
        }
        else
        {
            // make sure it conforms to ID restrictions
            if (!ID_REGEX.test(desiredProjectId))
                return this.error$("Desired ID is not a valid lowercase UUID (ex. \"584dbb83-2436-481d-898f-6d2358d220e2\")");
        }

        const title = this.form.title$() || "";
        if (!title)
        {
            if (!confirm("Are you sure you want to create a project with a blank Title?"))
                return;
        }
        const description = this.form.description$() || "";

        const meta = {
            locale: navigator.language.toLowerCase(),
            title,
            description,
        };

        this.busy$(true);
        this.error$("");
        try
        {
            const rsp = await API.postNewProjectDocument({ meta, desiredProjectId, gameFeaturesets: [], requiredRedirectorStartingVersion: "" });
            this._parent.openProject(rsp.projectId);
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

export default NewProjectModal;