/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import "../js/jszip.min";

import * as API from "@www/api";
import { parseBuildString } from "@www/helpers";
import { parseErrorMessage } from "@www/util/errors";

import { SelectOption, StagedFile } from "@www/models";
import { ModuleDoc, ContentRole, ProjectUserInfo, ModuleVersionDocWithArtifacts, ModuleVersionStatus, JobPlatform, ModerationSource, ModuleSafetyStatus } from "@app/types";

import AuthUser from "@www/auth/user.model";

// configuration.
import config from "@www/config";
ko.options.deferUpdates = true;

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

// import and register custom components.
import PageHeader from "@www/components/page-header/page-header";
PageHeader.RegisterComponents(config);

import CookBinariesModal from "@www/components/cook-binaries-modal";
CookBinariesModal.RegisterComponents();

import ValidateModal from "@www/components/validate-modal";
ValidateModal.RegisterComponents();

import NewVersionModal from "@www/components/new-version-modal";
NewVersionModal.RegisterComponents(config);

import { ViewMetaModal } from "@www/components/view-metadata-modal";
ViewMetaModal.RegisterComponents(config);

import MetaEditor from "@www/components/meta-editor/meta-editor";
MetaEditor.RegisterComponents(config);

// expose API globally so we can monkey debug
// TODO - remove this abuse of "any" type globally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.API = API;

/** extend main view model with app specific fields and methods. */
class MainViewModel {
    /** modal context used by the page for cooking all binaries for a content version. */
    public readonly cookBinariesModal: CookBinariesModal;

    /** modal context used by the page for running additional validation. */
    public readonly validateModal: ValidateModal;

    /** modal context used by the page for building new pieces of content. */
    public readonly newVersionModal: NewVersionModal;

    /** modal context used by the page for viewing content document meta. */
    public readonly viewMetaModal: ViewMetaModal;

    /** (COMMON) refences the page's location.hashchange event delegate. */
    protected _hashChangeFn = (): void => this._applyHashState();

    /** (COMMON) tracks the number of active async tasks. */
    protected _asyncTaskCnt = 0;

    /** (COMMON) shared page header. */
    public readonly pageHeader: PageHeader;

    /** (COMMON) tracks authenticated user. */
    public readonly user = new AuthUser();

    /** (COMMON) tracks the page's busy state. */
    public readonly busy$ = ko.observable<boolean>(false);

    /** (COMMON) tracks the page's current error text. */
    public readonly error$ = ko.observable<string>("");

    /** (COMMON) tracks the staged file download process. */
    public readonly downloadStatus$ = ko.observable<string>("");

    /** (COMMON) lists available to use for any triggered UCS/CCCP job. */
    public readonly jobPlatforms$ = ko.observableArray(["windows", "linux"]);

    /** (COMMON) tracks which platform to use for any triggered UCS/CCCP job. */
    public readonly selectedJobPlatform$ = ko.observable<JobPlatform>("windows");

    /** Controls visibility of job platform selection */
    public readonly enableJobPlatformSelection$ = ko.observable<boolean>(false);

    /** emits the active content document, or null. */
    public readonly contentDoc$ = ko.observable<ModuleDoc>();
    public readonly moduleVersionStatusDoc$ = ko.observable<ModuleVersionStatus>();
    public readonly projectInfo$ = ko.observable<ProjectUserInfo>();

    // can the user download projects
    public readonly hasProjectDownloadPermission$ = ko.observable<boolean|undefined>(false);

    /** emits the active content version document, or null. */
    public readonly contentVersionDoc$ = ko.observable<ModuleVersionDocWithArtifacts>();

    /** emits the active content version API or undefined */
    public readonly contentVersionApi$ = ko.observable<{ pending: boolean, api: Record<string, unknown> }>();

    /** tracks the blob url used for downloading zip of staged files. */
    protected _downloadStagedFilesURL = "";

    /** tracks the page's form field observables. */
    public readonly form = {
        /** moduleId input value. */
        moduleId$: ko.observable<string>(),

        /** content version selected value. */
        moduleVersion$: ko.observable<number>(),

        /** (computed) content version select options. */
        contentVersionOptions$: ko.computed<SelectOption[]>(() => this.buildContentVersionOptions()),

        /** content version active tab. */
        cvTab$: ko.observable<"dependencies" | "artifacts" | "stagedFiles" | "api">("stagedFiles"),

        /** (computed) content relevance list. */
        contentRelevanceList$: ko.computed<string[]>(() => this.buildContentRelevanceList()),

        contentVersionStagedFiles$: ko.computed<StagedFile[]>(() => this.buildContentVersionStagedFiles()),
    };

    constructor() {
        // initialize component contexts.
        this.pageHeader = new PageHeader(this);
        this.cookBinariesModal = new CookBinariesModal(this);
        this.validateModal = new ValidateModal(this);
        this.newVersionModal = new NewVersionModal(this);
        this.viewMetaModal = new ViewMetaModal("module", this);

        // whenever the contentDoc changes, sync the appropriate form fields.
        this.contentDoc$.subscribe((doc) => {
            if (doc) {
                document.title = doc.moduleName || doc.meta.description as string | undefined || doc.moduleId;
            } else {
                document.title = "Content Service";
            }
        });

        void this.user.init().then(() => {
            // apply any state currently present in the hash.
            if (this.user.loggedIn$()) {
                this._applyHashState();
                void this._checkForWebClientPermissions();
            }
            else
                this.user.login();
        });

        // feature flag checks for UI features
        void this._performOperationAsync(async () => {

            const defaultJobPlatform = await API.getDefaultJobPlatform();
            this.selectedJobPlatform$(defaultJobPlatform);

            const enableJobPlatformSelection = await API.isFeatureFlagEnabled("enable-job-platform-selection");
            this.enableJobPlatformSelection$(enableJobPlatformSelection);

            // work around to get specific module version if given rather than load latest no matter what.
            const selectedModuleId = parseInt(window.location.href.split('@').pop() ?? "");
            if (selectedModuleId) {
                await this.setActiveModuleDoc(undefined, selectedModuleId);
            }

        }, true);
    }

    public changeModuleName(): void {
        const module = this.contentDoc$();

        if (!module)
            return;

        const newName = prompt("Set Module Name in project.", module.moduleName);
        if (newName === null)
            return;

        void this._performOperationAsync(async () => {
            await API.setModuleName(module.moduleId, newName);

            const newContent = { ...module, moduleName: newName };
            this.contentDoc$(newContent);
            window.location.href = `/module/#/${module.moduleId}`;
        });
    }

    public parseModerationSource(source?: ModerationSource) : string {
        if(source == undefined || source == null)
            return "Unknown"

        switch(source){
            case "system":
                return "Moderation Completed";
            case "commandlet_error":
            case "ingestion_error":
            case "error":
                return "Moderation Error";
            case "manual":
            case "admin_action":
                return "Admin Action"
            default:
                return "Unknown"
        }
    }

    public getModerationStatusColor(status?: ModuleSafetyStatus): string {
        if(status == undefined || status == null)
            return "grey";

        switch(status) {
            case "failed_hard":
            case "failed_soft":
                return "red";
            case "passed":
                return "green";
            default:
                return "grey";
        }
    }

    public getMeta(): { meta: Record<string, unknown>, docId: string } | undefined {
        const contentDoc = this.contentDoc$();
        if (!contentDoc)
            return undefined;
        return { meta: contentDoc.meta, docId: contentDoc.moduleId };
    }

    public setMeta(meta: Record<string, unknown>): void {
        const newContent = { ...this.contentDoc$(), meta };
        this.contentDoc$(newContent as ModuleDoc);
    }

    public getProjectId(): string | undefined {
        return this.contentDoc$()?.projectId;
    }

    public goToProject(): void  {
        const projectId = this.getProjectId();
        if (!projectId)
            return;
        window.location.href = `/project/#/${encodeURIComponent(projectId)}`;
    }

    public loadApi(): void  {
        const versionDoc = this.contentVersionDoc$();
        if (versionDoc === undefined)
            return; // no version specified
        if (this.contentVersionApi$() !== undefined)
            return; // already loaded
        let api: Record<string, unknown> = {};
        this.contentVersionApi$({ pending: true, api });
        API.getStagedFile(versionDoc, "public/api.json").then(async (file) => {
            const apiText = await file.text();
            console.log("API", apiText);
            api = JSON.parse(apiText);
        }).catch((err) => {
            const message = parseErrorMessage(err);
            this.error$(message);
        }).finally(() => {
            if (this.contentVersionDoc$() === versionDoc)
                this.contentVersionApi$({ pending: false, api });
        });
    }

    public purgeBinaries(): void  {
        const moduleId = this.contentDoc$()?.moduleId;
        if (!moduleId)
            return;
        void this._performOperationAsync(async () => {
            if (!confirm("[ADMIN] Are you sure you want to remove ALL cached cooked content for this module for ALL versions?"))
                return;
            await API.purgeModuleArtifacts(moduleId);
            alert("Success!");
        });
    }

    public purgeBinariesForVersion(): void  {
        const moduleId = this.contentDoc$()?.moduleId;
        const moduleVersion = this.form.moduleVersion$();
        if (!moduleId || !moduleVersion)
            return;
        void this._performOperationAsync(async () => {
            if (!confirm(`[ADMIN] Are you sure you want to remove cached cooked content for this module at version ${moduleVersion}? This only works for cooks made after 2024-02-22.`))
                return;
            await API.purgeModuleArtifactsForVersion(moduleId, moduleVersion);
            alert("Success!");
        });
    }

    public purgeCache(): void {
        const moduleId = this.contentDoc$()?.moduleId;
        if (!moduleId)
            return;
        void this._performOperationAsync(async () => {
            if (!confirm("[ADMIN] Are you sure you want to purge the cache for this module?"))
                return;
            await API.purgeModuleCache(moduleId);
            alert("Success!");
        });
    }

    public fetchBinaries(artifactId: string): void {
        void this._performOperationAsync(async () => {
            const output = document.getElementById(`binaries-${artifactId}`);
            if (!output)
                throw new Error(`could not find output DIV for ${artifactId}`);

            // prompt for which build to fetch for
            const buildstr = prompt("Fetch binaries compatible with what FN Build?\n\nValid examples include \"main\", \"12.30\", \"14.20.123424323\", \"valkyrie.882343272\"");
            if (!buildstr)
                return; // cancelled

            // validate build string.
            const buildver = parseBuildString(buildstr);

            // eslint-disable-next-line no-constant-condition
            while (true) {
                const result = await API.getArtifactCookResult(artifactId, buildver, this.selectedJobPlatform$());
                if (result.status === "pending") {
                    const elapsedMs = new Date().getTime() - result.start.getTime();
                    output.innerText = `Cook pending (job ID ${result.cookJobId}). ${Math.floor(elapsedMs / 1000)} seconds elapsed.`;
                } else if (result.status === "failed") {
                    output.innerText = `Cook failed (job ID ${result.cookJobId}). ${result.errorCode} - ${result.errorMessage}`;
                    break;
                } else {
                    // TODO: there's probably a more KO friendly way to render this
                    let html = "<ul>\n";
                    const baseUrl = result.output.baseUrl;
                    if (result.output.manifest) {
                        if (baseUrl)
                            html += `<li><b>Manifest:</b> <a href="${baseUrl}${result.output.manifest}">${result.output.manifest}</a></li>\n`;
                        else
                            html += `<li><b>Manifest:</b> ${result.output.manifest}</li>\n`;
                    }
                    for (const file of result.output.files) {
                        if (baseUrl)
                            html += `<li><a href="${baseUrl}${file}">${file}</a></li>\n`;
                        else
                            html += `<li>${file}</li>\n`;
                    }
                    html += "</ul>\n";

                    // comp`ute size text.
                    const totalSizeKb = result.output.totalSizeKb;
                    let sizeText: string;
                    if (totalSizeKb < 0.1)
                        sizeText = `${totalSizeKb} KB`;
                    else if (totalSizeKb < 1024)
                        sizeText = `${Math.round(totalSizeKb * 100) / 100} KB`;
                    else if (totalSizeKb < 1024 * 1024)
                        sizeText = `${Math.round((totalSizeKb / 1024) * 100) / 100} MB`;
                    else
                        sizeText = `${Math.round((totalSizeKb / (1024 * 1024)) * 100) / 100} GB`;
                    html += `(v ${buildver.major}.${buildver.minor}.${buildver.patch} cooked ${result.end.toLocaleString()} by ${result.cooker}. ${sizeText} total)`;
                    output.innerHTML = html;
                    break;
                }

                // wait 30 sec and try again
                await new Promise((resolve) => {
                    setTimeout(resolve, 30 * 1000);
                });
            }
        });
    }

    /** set the page's active content and content version documents. */
    public setActiveModuleDoc(targetContent?: string | ModuleDoc, targetVersion?: number): Promise<any> {
        if (targetContent) {
            if (typeof (targetContent) === "string")
                this.form.moduleId$(targetContent);
            else
                this.form.moduleId$(targetContent.moduleId);
        }

        return this._performOperationAsync(async () => {

            if (!this.user.loggedIn$())
                return;

            // ensure target content is a valid string or object.
            targetContent = targetContent || this.form.moduleId$();
            if (!targetContent) {
                this.contentDoc$(undefined);
                this.contentVersionDoc$(undefined);
                this.contentVersionApi$(undefined);
                this.moduleVersionStatusDoc$(undefined);
                return; // can't proceed.
            }

            // reduce targetContent into strongly typed constituents.
            const moduleId = (typeof targetContent === "string") ? targetContent : targetContent.moduleId;
            let moduleDoc = (typeof targetContent === "string") ? undefined : targetContent;

            // reduce targetVersion into strongly typed constituents.
            let contentVersionDoc: ModuleVersionDocWithArtifacts | undefined = undefined;

            // make sure our form values are sync'd to the new target values before we begin.
            // note: final form values will ultimately be derrived from successfully returned data, we just want the ux to make sense in case data retrieval fails.
            this.form.moduleId$(moduleId);
            this.form.moduleVersion$(targetVersion);

            let moduleVersionStatus: ModuleVersionStatus | undefined = undefined;

            try {
                // fetch the content document if we weren't provided one.
                if (!moduleDoc)
                    moduleDoc = await API.getModuleDocument(moduleId);

                let currentProjectInfo = this.projectInfo$();
                if (currentProjectInfo === undefined || moduleDoc.projectId != currentProjectInfo.projectId) {
                    currentProjectInfo = await API.getProjectUserInfo(moduleDoc.projectId);
                    this.projectInfo$(currentProjectInfo);
                }

                // if version number isn't in range by now, then the supplied value is invalid.
                if (targetVersion === undefined || moduleDoc.latestVersion <= 0)
                    return; // there were no versions to resolve or default to.

                // fetch the version document
                contentVersionDoc = await API.getModuleVersion(moduleDoc.moduleId, targetVersion);

                // get the module safety status
                moduleVersionStatus = await API.getModuleVersionStatus(moduleDoc.moduleId, targetVersion);
            } finally {
                this.contentDoc$(moduleDoc);
                this.contentVersionDoc$(contentVersionDoc);
                this.contentVersionApi$(undefined);
                if (contentVersionDoc) {
                    if (contentVersionDoc.stagedFiles.files.length > 0)
                        this.form.cvTab$("stagedFiles");
                    else if (contentVersionDoc.artifacts.length > 0)
                        this.form.cvTab$("artifacts");
                    else
                        this.form.cvTab$("dependencies");
                }
                this.moduleVersionStatusDoc$(moduleVersionStatus);
                this._saveHashState();
            }
        });
    }

    /** construct an array of possible version options for the current content document. */
    public buildContentVersionOptions(): SelectOption[] {
        const contentDoc = this.contentDoc$();
        if (!contentDoc) return [];

        let validSelection = false;
        const latestVersion = contentDoc.latestVersion;
        let selectedVersion = this.form.moduleVersion$();
        if (latestVersion !== 0 && typeof selectedVersion !== "number") {
            selectedVersion = latestVersion;
            void this.setActiveModuleDoc(undefined, selectedVersion);
        }

        const result: SelectOption[] = [];
        for (let versionNumber = latestVersion; versionNumber > 0; versionNumber--) {
            // add the number itself
            result.push({ displayText: versionNumber.toString(), value: versionNumber });
            if (versionNumber === selectedVersion)
                validSelection = true;
        }

        // the currently selected version number isn't valid, but we need an item to represent it (so the user can switch away).
        if (result.length > 0 && !validSelection)
            result.unshift({ displayText: "-- invalid --", value: selectedVersion || "" });

        // inject an option to tell the user their are no versions to pick from.
        if (!result.length)
            result.push({ displayText: "-- none --", value: "" });

        return result;
    }

    public buildContentRelevanceList(): string [] {
        const contentDoc = this.contentDoc$();
        if (!contentDoc) return [];

        const result: string[] = [];
        for (const key of Object.keys(contentDoc.relevance)) {
            if (contentDoc.relevance[key as ContentRole])
                result.push(key);
        }
        return result;
    }

    public buildContentVersionStagedFiles(): StagedFile[] {
        const contentVersionDoc = this.contentVersionDoc$();
        if (!contentVersionDoc)
            return [];

        const result: StagedFile[] = [];
        const { baseUrl, files } = contentVersionDoc.stagedFiles;
        for (const name of files) {
            result.push({ name, url: `${baseUrl}${encodeURIComponent(name)}` });
        }

        return result;
    }

    public downloadContentVersionStagedFiles(name?: string): void {
        // valid version doc is required.
        const versionDoc = this.contentVersionDoc$();
        if (!versionDoc) return;

        void this._performOperationAsync(async () => {
            if (name) {
                // download a single staged file
                this.downloadStatus$("Preparing the file ...");

                const file = await API.getStagedFile(versionDoc, name);

                this.downloadStatus$("Downloading ...");
                URL.revokeObjectURL(this._downloadStagedFilesURL);
                this._downloadStagedFilesURL = URL.createObjectURL(await file.blob());

                // target a hidden <a> tag on the index page, configure and click() it invoke downloading of the file.
                const link: HTMLAnchorElement = document.getElementById("stagedFiledownload") as HTMLAnchorElement;
                link.href = this._downloadStagedFilesURL;
                link.download = name.split("/")[name.split("/").length - 1];
                link.click();
            } else {
                // downloads all staged files
                const files = await this._getLinksForStagedFiles(versionDoc);

                // add all the result blobs to a zip archive.
                const zip = new JSZip();
                let filesDownloaded = 0;
                for (let i = 0; i < files.length; ++i) {
                    this.downloadStatus$(`Downloading files ${filesDownloaded++}/${files.length}`);
                    const name = versionDoc.stagedFiles.files[i];
                    const file = files[i];

                    const blob = await file.blob();
                    console.log(`downloaded ${name}: ${blob.size} bytes.`);
                    zip.file(name, blob);
                }

                await this._generateZipAsync(zip, versionDoc.moduleId, versionDoc.version);
            }
        });
    }

    public downloadFilesInBatch(): void {
        // valid version doc is required.
        const versionDoc = this.contentVersionDoc$();
        if (!versionDoc) return;

        void this._performOperationAsync(async () => {
            /*
                We are going to compress files in batches of 500mb.
                If a file is larger than 500mb we will dedicate a compression operation for it
            */
            const limitSize = 500000000;
            const files = await this._getLinksForStagedFiles(versionDoc);

            let zip = new JSZip();
            let byteCount = 0;
            let moduleParts = 1;
            let filesDownloaded = 0;
            for (let i = 0; i < files.length; ++i) {
                this.downloadStatus$(`Downloading files ${filesDownloaded++}/${files.length}`);
                const name = versionDoc.stagedFiles.files[i];
                const file = files[i];

                const blob = await file.blob();
                console.log(`downloaded ${name}: ${blob.size} bytes.`);

                // if-immediate is the fastest way to perform this operations
                if (byteCount + blob.size < limitSize) {
                    byteCount += blob.size;
                    zip.file(name, blob);
                    continue;
                }

                if (byteCount + blob.size === limitSize) {
                    zip.file(name, blob);
                }

                await this._generateZipAsync(zip, versionDoc.moduleId, versionDoc.version, moduleParts)
                    .then(() => {
                        const hasExceedLimitSize = byteCount + blob.size > limitSize;
                        byteCount = hasExceedLimitSize ? blob.size : 0;

                        moduleParts++;
                        zip = new JSZip();

                        if (hasExceedLimitSize) {
                            zip.file(name, blob);
                        }
                    });
            }

            if (byteCount > 0) {
                await this._generateZipAsync(zip, versionDoc.moduleId, versionDoc.version, moduleParts);
            }
        });
    }

    public downloadModuleZipJobFiles(): void {
        // valid version doc is required.
        const versionDoc = this.contentVersionDoc$();
        if (!versionDoc) return;

        // make sure user really wants to do this as it may take a while.
        if (!confirm("Zip module files via a UCS job and download them? This may take a while.")) return;

        void this._performOperationAsync(async () => {
            const zipFile = await API.getZipFile(versionDoc, this.selectedJobPlatform$());
            const data = await zipFile.blob();

            // revoke any previous, and then build a new data url for the generated archive.
            URL.revokeObjectURL(this._downloadStagedFilesURL);
            this._downloadStagedFilesURL = URL.createObjectURL(data);

            // target a hidden <a> tag on the index page, configure and click() it invoke downloading of the zip.
            const link: HTMLAnchorElement = document.getElementById("stagedFiledownload") as HTMLAnchorElement;
            link.href = this._downloadStagedFilesURL;
            link.download = `${versionDoc.moduleId}@${versionDoc.version}.zip`;
            link.click();
        });
    }

    /**
     * Downloads a single or a list of zip files which contains the staged files of the modules compressed
     *
     * @param zip JSzip object which will execute the compression process
     * @param moduleId
     * @param version Module version
     * @param filePart Can be null. It is used to determine which part of the module is being created and set the name of the zip.
     */
    protected async _generateZipAsync(zip: JSZip, moduleId: string, version: number, filePart?: number): Promise<void> {
        // generate the zip archive.
        await zip.generateAsync(
            {
                type: "blob",
                compression: "DEFLATE",
                // the compressionOptions.level property will increase the compression speed to the detriment of the file size. The lower the level, the higher the speed
                compressionOptions: { level: 1 }
            },
            // this function gets called whenever a file is compressed
            (metadata) => {
                let msg = filePart
                    ? `Generating zip for part ${filePart}. ${metadata.percent.toFixed(2)}%`
                    : `Generating zip ${metadata.percent.toFixed(2)}%`;
                if (metadata.currentFile) {
                    msg += `. Current file = ${metadata.currentFile}`;
                }
                this.downloadStatus$(msg);
            })
            .then((compressedFile) => {
                // revoke any previous, and then build a new data url for the generated archive.
                URL.revokeObjectURL(this._downloadStagedFilesURL);
                this._downloadStagedFilesURL = URL.createObjectURL(compressedFile);

                // target a hidden <a> tag on the index page, configure and click() it invoke downloading of the zip.
                const link: HTMLAnchorElement = document.getElementById("stagedFiledownload") as HTMLAnchorElement;
                link.href = this._downloadStagedFilesURL;
                link.download = filePart ? `${moduleId}@${version}_part${filePart}.zip` : `${moduleId}@${version}.zip`;
                link.click();

                return Promise.resolve();
            });
    }

    /**
     *
     * @param versionDoc ModuleVersionDocWithArtifacts used to get the file names of the module
     * @returns a list of Promise<Response> which contains a redirect to actually download the file
     */
    protected async _getLinksForStagedFiles(versionDoc: ModuleVersionDocWithArtifacts): Promise<Response[]> {
        const filePromises: Promise<Response>[] = [];
        let liksGot = 0;
        for (let i = 0; i < versionDoc.stagedFiles.files.length; i++) {
            this.downloadStatus$(`Preparing the files ${i + 1}/${versionDoc.stagedFiles.files.length}`);
            filePromises.push(API.getStagedFile(versionDoc, versionDoc.stagedFiles.files[i])
                .then((file) => {
                    this.downloadStatus$(`Getting download links ${liksGot++}/${versionDoc.stagedFiles.files.length}`);
                    return file;
                }));
        }
        return await Promise.all(filePromises);
    }

    protected _saveHashState(): void {
        const moduleId = this.form.moduleId$() || this.contentDoc$()?.moduleId;
        const version = this.form.moduleVersion$();

        if (!moduleId) {
            location.hash = "#/";
            return;
        }

        const oldHash = location.hash;
        let newHash = `#/${moduleId}`;

        if (version)
            newHash = `${newHash}@${version}`;

        // prevent triggering unnecessary change events.
        if (newHash === oldHash)
            return;

        // we don't want to re-apply any state as a result of this change.
        $(window).off("hashchange", this._hashChangeFn);
        location.hash = newHash;
        setTimeout(() => $(window).one("hashchange", this._hashChangeFn));
    }

    protected _applyHashState(): void {
        this.error$("");

        // eslint-disable-next-line no-useless-escape
        const HASH_REGEX = new RegExp("^#/(?<moduleId>[^@/]+)([@/](?<version>\d+)$)?");
        const match = location.hash.match(HASH_REGEX);
        const moduleId = match?.groups?.moduleId;
        const version = parseInt(match?.groups?.version || "");
        if (moduleId) {
            void this.setActiveModuleDoc(moduleId, version > 0 ? version : undefined);
        } else {
            this.form.moduleId$(undefined);
        }

        // re-apply the next time hash is changed.
        $(window).off("hashchange", this._hashChangeFn);
        $(window).one("hashchange", this._hashChangeFn);
    }

    /** does some work while the page is kept in the busy state, errors are parsed and bubbled up to the UI. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected async _performOperationAsync<T>(stuff: () => Promise<T>, suppressErrors = false): Promise<any> {
        this._asyncTaskCnt++;
        this.error$("");
        this.downloadStatus$("");
        this.busy$(true);

        try {
            return await stuff();
        } catch (err) {
            if (suppressErrors) {
                return undefined;
            }
            this.error$(parseErrorMessage(err));
            return undefined;
        } finally {
            if (--this._asyncTaskCnt <= 0) {
                this._asyncTaskCnt = 0;
                this.busy$(false);
            }
        }
    }

    private async _checkForWebClientPermissions(): Promise<void> {
        const webClientConfig = await API.getWebClientConfig();
        const { permissions } = webClientConfig;
        this.hasProjectDownloadPermission$(permissions.canDownloadModules);
    }
}

// apply main view model to HTML template.
ko.applyBindings(new MainViewModel());
