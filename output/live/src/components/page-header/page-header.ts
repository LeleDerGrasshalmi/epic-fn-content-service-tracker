import * as API from "@www/api";
import type AuthUser from "@www/auth/user.model";
import { ApplicationUrl } from "@app/types";

const MNEMONIC_REGEX = new RegExp("^\\d\\d\\d\\d-\\d\\d\\d\\d-\\d\\d\\d\\d$");

type ParentInterface = {
    busy$: KnockoutObservable<boolean>;
    user: AuthUser;
    goToInventory?: () => void;
};

interface ComponentConfig
{
}

interface ApplicationInfo extends ApplicationUrl {
    style : string
}

class PageHeader {
    public static RegisterComponents(_config: ComponentConfig): void {
        ko.components.register("page-header", {
            template: { fromUrl: "/src/components/page-header/page-header.html" },
            viewModel: { fromContextType: PageHeader },
        });
    }

    public readonly user: AuthUser;

    public readonly currentApplication$ = ko.observable<ApplicationInfo>();
    public readonly allApplications$ = ko.observableArray<ApplicationInfo>([]);

    public readonly permissions$ = ko.observable<Record<string,true|undefined>>({});

    public readonly $rootEl: JQuery = $();

    public goToInventory?: () => void;

    protected readonly _parent: ParentInterface;

    /** tracks the blob url used for downloading zip of scratch files. */
    protected _downloadInvalidScratchURL = "";

    // Controls visibility of button to download invalid scratch content
    public readonly enableDownloadInvalidScratchContent$ = ko.observable<boolean>(false);

    // form fields
    public readonly form = {
        name$: ko.observable<string>(""),
        description$: ko.observable<string>(""),
    };

    constructor(parent: ParentInterface) {
        this._parent = parent;
        this.user = parent.user;
        this.goToInventory = parent.goToInventory;

        void this._getWebClientPermissions();

        // feature flag checks for UI features
        // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
        void (async () => {
            try {
                const enableDownloadInvalidScratchContent = await API.isFeatureFlagEnabled("enable-invalid-scratch-storage");
                this.enableDownloadInvalidScratchContent$(enableDownloadInvalidScratchContent);
            }
            catch {
                this.enableDownloadInvalidScratchContent$(false);
                console.log("[PageHeader:constructor] unable to read feature flag value");
            }
        })();
    }

    public async downloadInvalidScratch(): Promise<void> {

            const failedValidationJobId = prompt("Enter Failed Validation Job Id:");
            if (!failedValidationJobId)
                return;

            const zipFile = await API.downloadInvalidScratchContent(failedValidationJobId);
            const data = await zipFile.blob();

            // revoke any previous, and then build a new data url for the generated archive.
            URL.revokeObjectURL(this._downloadInvalidScratchURL);
            this._downloadInvalidScratchURL = URL.createObjectURL(data);

            // target a hidden <a> tag on the index page, configure and click() it invoke downloading of the zip.
            const link: HTMLAnchorElement = document.getElementById("invalidScratchDownload") as HTMLAnchorElement;
            link.href = this._downloadInvalidScratchURL;
            link.download = "scratch.zip";
            link.click();
    }

    private async _getWebClientPermissions(): Promise<void> {
        const webClientConfig = await API.getWebClientConfig();
        this.permissions$(webClientConfig.permissions);

        const currentApplication = webClientConfig.deployment === "latest" ? webClientConfig.environment : webClientConfig.deployment;
        this.currentApplication$( {name:currentApplication, link:"/", style:`application-${currentApplication}` });
        this.allApplications$(webClientConfig.applicationUrls.map(url => ({ ...url, style: `application-${url.name}`})));
    }

    public async findAndOpenSomething(id?: string): Promise<void> {
        if (!id?.trim())
            id = prompt("What do you want to find?") || undefined;

        if (!id?.trim()) {
            console.warn("ID is required.");
            return;
        }
        let targetId = id.trim();

        const mnemonic = targetId.match(MNEMONIC_REGEX);
        if (mnemonic)
        {
            // resolve link mnemonic into a projectId.
            try
            {
                const info = await API.getIslandCodeInfo(mnemonic[0]);
                window.location.href = `/project/#/${info.projectId}`;
                return;
            } catch {
                // continue;
            }
        }
        else
        {
            // translate verse paths to project ID
            if (targetId.startsWith("/") || targetId.startsWith("verse:/")) {
                const res = await API.resolveVersePath(targetId);
                targetId = res.target.projectId;
            }

            // try project
            try {
                const project = await API.getProjectDocument(targetId);
                window.location.href = `/project/#/${project.projectId}`;
                return;
            } catch {
            // continue;
            }

            // try module
            try {
                const module = await API.getModuleDocument(targetId);
                window.location.href = `/module/#/${module.moduleId}`;
                return;
            } catch {
            // continue;
            }

            // try team
            try {
                const team = await API.getTeamById(targetId);
                if (team) {
                    window.location.href = `/team/#/${team.teamId}`;
                    return;
                }
            } catch {
            // continue;
            }
        }

        alert(`Unable to locate anything with ID: ${targetId}`);
    }
}

export default PageHeader;