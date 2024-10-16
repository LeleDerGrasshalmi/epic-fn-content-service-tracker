import * as API from "@www/api";
import { RuntimeRelevance } from "@app/types";
import { parseErrorMessage } from "@www/util/errors";

const containsOnlyValidModuleNameCharacters = function(str: String): boolean
{
    for (let i=0;i<str.length;++i)
    {
        let ch = str.charCodeAt(i);
        if (ch === 45)
            continue; // - (dash)
        if (ch === 95)
            continue; // _ (underscore)
        if (ch === 58)
            continue; // : (colon)
        if (ch >= 48 && ch <= 57)
            continue; // 0-9
        if (ch >= 97 && ch <= 122)
            continue; // a-z
        return false;
    }
    return true;
}
const ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const DEFAULT_NOTE = "";

type ParentInterface = {
    busy$: KnockoutObservable<boolean>;
    openModule(moduleId: string): void;
    getProjectId(): string|undefined;
};

interface ComponentConfig
{
}

class NewContentModal
{
    public static RegisterComponents(_config: ComponentConfig)
    {
        ko.components.register("new-module-modal", {
            template: { fromUrl: `/src/components/new-module-modal.html` },
            viewModel: { fromContextType: NewContentModal },
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
        desiredContentId$: ko.observable<string>(),
        moduleName$: ko.observable<string>(""),
        description$: ko.observable(DEFAULT_NOTE),
        contentType$: ko.observable<string>(),
        contentTypeOptions$: ko.observable<string[]>(),
        clientRelevance$: ko.observable<boolean>(true),
        serverRelevance$: ko.observable<boolean>(true),
    };

    constructor(parent: ParentInterface)
    {
        this._parent = parent;
    }

    protected async _init()
    {
        this._$modal = this.$rootEl.children().first();

        let options = this.form.contentTypeOptions$();
        let defaultOption = options && options[0];

        if (!options)
        {
            try
            {
                this._parent.busy$(true);
                options = (await API.getWebClientConfig()).contentTypes.map(info => info.contentType);
                defaultOption = options[0];
                this.form.contentTypeOptions$(options);
            }
            catch(e)
            {
                this.error$(parseErrorMessage(e));
            }
            finally
            {
                this._parent.busy$(false);
            }
        }

        this.error$("");
        this.busy$(false);
        this.form.moduleName$("");
        this.form.description$(DEFAULT_NOTE);
        this.form.contentType$(defaultOption);
        this.form.clientRelevance$(true);
        this.form.serverRelevance$(true);
    }

    public async show()
    {
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

    public async submit()
    {
        if (this.busy$())
            return;

        const projectId = this._parent.getProjectId();
        if (!projectId)
            return this.error$("Modules must be created in the context of a project");

        const contentType = this.form.contentType$();
        if (!contentType)
            return this.error$("Content type is required.");

        const relevance: RuntimeRelevance = {
            client: this.form.clientRelevance$(),
            server: this.form.serverRelevance$(),
            editor: true,
        };
        if (!relevance.client && !relevance.server)
            return this.error$("At least one relevance option must be set.");

        let moduleName = this.form.moduleName$().trim();
        if (moduleName.length > 64)
            return this.error$("Module Name is too long (max: 64)");
        if (!containsOnlyValidModuleNameCharacters(moduleName))
            return this.error$("Module Name contains illegal characters (allowed: \"-_0-9a-z:\" ).");
        if (moduleName.startsWith(":"))
            moduleName = moduleName.substr(1); // don't start with colon (common error, just chop it)
        if (moduleName.indexOf("::") >= 0)
            return this.error$("Module Name may not contain multiple consecutive colons");
        if (moduleName.endsWith(":"))
            return this.error$("Module Name may not end with colon");

        let desiredModuleId = this.form.desiredContentId$()?.trim();
        if (!desiredModuleId)
        {
            // don't pass it up at all if blank
            desiredModuleId = undefined;
        }
        else
        {
            // make sure it conforms to ID restrictions
            if (desiredModuleId.length < 8)
                return this.error$("Desired ID is too short (min: 8 chars).");
            if (desiredModuleId.length > 64)
                return this.error$("Desired ID is too long (max: 64 chars).");
            if (!ID_REGEX.test(desiredModuleId))
                return this.error$("Desired ID is not a valid lowercase UUID (ex. \"584dbb83-2436-481d-898f-6d2358d220e2\")");
        }

        const description = this.form.description$() || "";
        if (!description && !moduleName)
            return this.error$("Unnamed module description should not be blank.");

        const meta = {
            description,
        };

        this.busy$(true);
        this.error$("");
        try
        {
            const rsp = await API.postNewModuleDocument(projectId, { moduleName, meta, contentType, relevance, desiredModuleId });

            this._parent.openModule(rsp.moduleId);
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

export default NewContentModal;