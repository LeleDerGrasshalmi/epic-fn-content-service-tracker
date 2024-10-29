// Copyright Epic Games, Inc. All Rights Reserved.

/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-floating-promises */

import * as API from "@www/api";
import { parseErrorMessage } from "@www/util/errors";
import { ModuleSearchResult, ProjectUserInfo, ProjectDoc, PublishedLink, VerseRuntimeErrorCrashGroup } from "@app/types";
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

import PageHeader from "@www/components/page-header/page-header";
PageHeader.RegisterComponents(config);

import NewModuleModal from "@www/components/new-module-modal";
NewModuleModal.RegisterComponents(config);

import { ViewMetaModal, ViewSysMetaModal } from "@www/components/view-metadata-modal";
ViewMetaModal.RegisterComponents(config);
ViewSysMetaModal.RegisterComponents(config);

import MetaEditor from "@www/components/meta-editor/meta-editor";
MetaEditor.RegisterComponents(config);

import VerseRuntimeErrorReportsGroupList from "@www/components/verse-runtime-error-reports/verse-runtime-error-reports-group-list";
VerseRuntimeErrorReportsGroupList.RegisterComponents(config);

// expose API globally so we can monkey debug
window.API = API;

/** extend main view model with app specific fields and methods. */
class MainViewModel {
    public readonly newModuleModal: NewModuleModal;

    public readonly viewMetaModal: ViewMetaModal;

    public readonly viewSysMetaModal: ViewSysMetaModal;

    public readonly verseRuntimeErrorReportsGroupList: VerseRuntimeErrorReportsGroupList;

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
    public readonly feedback$ = ko.observable<string>("");

    // does the project have a star or not
    public readonly hasStar$ = ko.observable<boolean|undefined>();

    // should we show unused PTGs (to add to the project)
    public readonly showUnusedPtgs$ = ko.observable<boolean>(false);

    // can the user update sysMeta
    public readonly permissions$ = ko.observable<Record<string,true|undefined>>({});

    // project document
    public readonly projectDoc$ = ko.observable<ProjectDoc>();
    public readonly projectInfo$ = ko.observable<ProjectUserInfo>();
    public readonly projectAddresses$ = ko.observableArray<{ versePath: string, url: string, primary: boolean }>([]);
    public readonly playtestCodes$ = ko.observableArray<{ group: { id: string, name: string }, link?: PublishedLink }>([]);

    // which tab are we on
    public readonly tab$ = ko.observable<"modules"|"buildcodes"|"mybuildcodes"|"versestats">();

    /** tracks the page's form field observables. */
    public readonly form = {
        projectId$: ko.observable<string>(),
    };

    // form fields
    public readonly modulesForm = {
        searchResults$: ko.observableArray<ModuleSearchResult>([]),
        hasMore$: ko.observable<boolean>(false),
        _limit: 0,
        _total: 0,
        _initialized: false,
    };
    public readonly buildCodesForm = {
        searchResults$: ko.observableArray<PublishedLink>([]),
        hasMore$: ko.observable<boolean>(false),
        _limit: 0,
        _total: 0,
        _initialized: false,
    };
    public readonly myBuildCodesForm = {
        searchResults$: ko.observableArray<PublishedLink>([]),
        hasMore$: ko.observable<boolean>(false),
        _limit: 0,
        _total: 0,
        _initialized: false,
    };
    public readonly verseRuntimeErrorReportGroupsForm = {
        searchResults$: ko.observableArray<VerseRuntimeErrorCrashGroup>([]),
        hasMore$: ko.observable<boolean>(false),
        _limit: 0,
        _total: 0,
        _initialized: false,
    };

    constructor() {
        // initialize component contexts.
        this.pageHeader = new PageHeader(this);
        this.newModuleModal = new NewModuleModal(this);
        this.viewMetaModal = new ViewMetaModal("project", this);
        this.viewSysMetaModal = new ViewSysMetaModal("project", this);

        this.tab$.subscribe((mode) => {
            switch (mode) {
                case "modules":
                    if (!this.modulesForm._initialized)
                        void this.loadMoreModules();
                    break;
                case "buildcodes":
                    if (!this.buildCodesForm._initialized)
                        void this.loadMoreBuildCodes();
                    break;
                case "mybuildcodes":
                    if (!this.myBuildCodesForm._initialized)
                        void this.loadMoreOfMyBuildCodes();
                    break;
                case "versestats":
                    if (!this.verseRuntimeErrorReportGroupsForm._initialized)
                        void this.loadMoreVerseRuntimeErrorReportGroups();
                    break;
            }
        });

        // whenever the contentDoc changes, sync the appropriate form fields.
        this.projectDoc$.subscribe((doc) => {
            if (doc) {
                this.form.projectId$(doc.projectId);
                document.title = doc.meta.title as string|undefined || doc.projectId;

                this.resetModulesForm();
                this.resetBuildCodesForm();
                this.resetMyBuildCodesForm();
                this.resetVerseStatsForm();
                if (this.tab$() === "buildcodes")
                    void this.loadMoreBuildCodes(); // this.tab$.subscribe won't fire, load build codes.
                else
                    this.tab$("versestats"); // this.tab$.subscribe will filre and loadbuild codes.
            } else {
                document.title = "Content Service";
            }
        });
        this.playtestCodes$.subscribe((codes) => {
            let hasUnusedCodes = false;
            for (const code of codes) {
                if (!code.link) {
                    hasUnusedCodes = true;
                    break;
                }
            }
            this.showUnusedPtgs$(!hasUnusedCodes);
        });

        void this.user.init().then(() => {
            if (this.user.loggedIn$()) {
                // apply any state currently present in the hash.
                this._applyHashState();

                // check for client permissions to conditionally show UI options
                void this._checkForWebClientPermissions();
            } else {
                this.user.login();
            }
        });
    }

    private resetModulesForm(): void
    {
        this.modulesForm.searchResults$([]);
        this.modulesForm.hasMore$(false);
        this.modulesForm._limit = 0;
        this.modulesForm._total = 0;
        this.modulesForm._initialized = false;
    }

    private resetBuildCodesForm(): void
    {
        this.buildCodesForm.searchResults$([]);
        this.buildCodesForm.hasMore$(false);
        this.buildCodesForm._limit = 0;
        this.buildCodesForm._total = 0;
        this.buildCodesForm._initialized = false;
    }

    private resetMyBuildCodesForm(): void
    {
        this.myBuildCodesForm.searchResults$([]);
        this.myBuildCodesForm.hasMore$(false);
        this.myBuildCodesForm._limit = 0;
        this.myBuildCodesForm._total = 0;
        this.myBuildCodesForm._initialized = false;
    }

    private resetVerseStatsForm(): void
    {
        this.verseRuntimeErrorReportGroupsForm.searchResults$([]);
        this.verseRuntimeErrorReportGroupsForm.hasMore$(false);
        this.verseRuntimeErrorReportGroupsForm._limit = 0;
        this.verseRuntimeErrorReportGroupsForm._total = 0;
        this.verseRuntimeErrorReportGroupsForm._initialized = false;
    }

    public async loadMoreModules(): Promise<void> {
        let next : Date|undefined = undefined;
        const results = this.modulesForm.searchResults$();
        const last = results[results.length - 1];
        if (last)
            next = moment(last.created).toDate();

        this._doStuff(async () => {
            const q = await API.findModulesInProject(this.getProjectId() || "00000000-0000-0000-0000-000000000000", next);

            this.modulesForm._limit += q.limit;
            this.modulesForm._total += q.results.length;
            this.modulesForm._initialized = true;

            ko.utils.arrayPushAll(this.modulesForm.searchResults$, q.results);
            this.modulesForm.hasMore$(this.modulesForm._total >= this.modulesForm._limit);
        });
    }

    public async loadMoreBuildCodes(): Promise<void> {
        let next : Date|undefined = undefined;
        const results = this.buildCodesForm.searchResults$();
        const last = results[results.length - 1];
        if (last)
            next = moment(last.lastPublished).toDate();

        this._doStuff(async () => {
            const q = await API.getBuildCodesForProject(this.getProjectId() || "00000000-0000-0000-0000-000000000000", next);
            this.buildCodesForm._limit += q.limit;
            this.buildCodesForm._total += q.results.length;
            this.buildCodesForm._initialized = true;

            ko.utils.arrayPushAll(this.buildCodesForm.searchResults$, q.results);
            this.buildCodesForm.hasMore$(this.buildCodesForm._total >= this.buildCodesForm._limit);
        });
    }

    public async loadMoreOfMyBuildCodes(): Promise<void> {
        let next : Date|undefined = undefined;
        const results = this.myBuildCodesForm.searchResults$();
        const last = results[results.length - 1];
        if (last)
            next = moment(last.lastPublished).toDate();

        this._doStuff(async () => {
            const q = await API.getMyBuildCodesForProject(this.getProjectId() || "00000000-0000-0000-0000-000000000000", next);
            this.myBuildCodesForm._limit += q.limit;
            this.myBuildCodesForm._total += q.results.length;
            this.myBuildCodesForm._initialized = true;

            ko.utils.arrayPushAll(this.myBuildCodesForm.searchResults$, q.results);
            this.myBuildCodesForm.hasMore$(this.myBuildCodesForm._total >= this.myBuildCodesForm._limit);
        });
    }

    public async loadMoreVerseRuntimeErrorReportGroups(): Promise<void> {
        const projectId = this.getProjectId();
        if (!projectId)
            return;

        this._doStuff(async () => {
            const q = await API.getVerseRuntimeErrorGroupsByProject(projectId)
            this.verseRuntimeErrorReportGroupsForm._limit += q.limit;
            this.verseRuntimeErrorReportGroupsForm._total += q.results.length;
            this.verseRuntimeErrorReportGroupsForm._initialized = true;
            ko.utils.arrayPushAll(this.verseRuntimeErrorReportGroupsForm.searchResults$, q.results);
            this.verseRuntimeErrorReportGroupsForm.hasMore$(this.verseRuntimeErrorReportGroupsForm._total >= this.verseRuntimeErrorReportGroupsForm._limit);
        });
    }

    public openModule(moduleId: string): void {
        window.location.href = `/module/#/${moduleId}`;
    }

    public getMeta(): { meta: Record<string, unknown>, docId: string } | undefined {
        const contentDoc = this.projectDoc$();
        if (!contentDoc)
            return undefined;
        return { meta: contentDoc.meta, docId: contentDoc.projectId };
    }

    public getSysMeta(): { sysMeta: Record<string, unknown>, docId: string } | undefined {
        const contentDoc = this.projectDoc$();
        if (!contentDoc)
            return undefined;
        return { sysMeta: contentDoc.sysMeta, docId: contentDoc.projectId };
    }

    public setMeta(meta: Record<string,unknown>): void {
        const projectDoc = this.projectDoc$();
        if (!projectDoc)
            throw new Error("project not set");

        const newContent = { ...projectDoc, meta };
        this.projectDoc$(newContent);
    }

    public setSysMeta(sysMeta: Record<string,unknown>): void {
        const projectDoc = this.projectDoc$();
        if (!projectDoc)
            throw new Error("project not set");

        const newContent = { ...projectDoc, sysMeta };
        this.projectDoc$(newContent);
    }

    public promotePlaytestCode(playtestGroupId: string): void {
        const project = this.projectDoc$();
        if (!project)
            return;

        // prompt for a buildcode to promote
        const buildCode = prompt("Enter the build code you would like to promote to this playtest group:\nEx: 1111-2222-3333");
        if (!buildCode)
            return;
        const BUILDCODE_REGEX = new RegExp("^(\\d\\d\\d\\d-\\d\\d\\d\\d-\\d\\d\\d\\d)(\\??v=?(\\d+))?$");
        const m = buildCode.match(BUILDCODE_REGEX);
        if (!m) {
            this.error$(`'${buildCode}' is not a valid build code (did you include the version?).`);
            return;
        }
        const code = m[1];
        const version = m[3] && parseInt(m[3]);
        if (version !== undefined && (typeof(version) !== "number" || !isFinite(version))) {
            this.error$(`'${buildCode}' is not a valid build code (did you include the version?).`);
            return;
        }

        // promot for commit message
        const commitMessage = prompt("Enter a commit message for this deployment:");
        if (!commitMessage)
            return;

        // call the server to promote it
        void this._doStuff(async () => {
            const result = await API.promoteBuildCode(project.projectId, { code, version }, commitMessage, playtestGroupId);
            // update the PTG list
            for (const g of this.playtestCodes$()) {
                if (g.group.id === playtestGroupId) {
                    this.playtestCodes$.replace(g, { group: g.group, link: result });
                    break;
                }
            }
        });
    }

    public purgeLiveLink(): void {
        const project = this.projectDoc$();
        if (!project)
            return;

        void this._doStuff(async () => {
            await API.purgeLiveLink(project.projectId);
            window.location.reload();
        });
    }

    public recordFNCPublish(): void {
        const project = this.projectDoc$();
        if (!project)
            return;

        alert("DANGER!! This is a sensitive operation.  Before proceeding, be 100% sure that the owner of this project is in fact the owner of the live link code you are about to report.");

        void this._doStuff(async () => {
            const linkCodeWithVersion = prompt("Enter the published live link code with version:");

            if (!linkCodeWithVersion)
                return;

            const LINKCODE_REGEX = new RegExp("^(\\d\\d\\d\\d-\\d\\d\\d\\d-\\d\\d\\d\\d)(\\??v=?(\\d+))?$");
            const m = linkCodeWithVersion.match(LINKCODE_REGEX);
            if (!m) {
                this.error$(`'${linkCodeWithVersion}' is not a valid link code.`);
                return;
            }

            const mnemonic = m[1];
            const version = m[3] && parseInt(m[3]);
            if (typeof(version) !== "number" || !isFinite(version)) {
                this.error$(`'${linkCodeWithVersion}' is not a valid build code (trouble parsing version).`);
                return;
            }

            await API.reportExternalPublish(project.projectId, mnemonic, version);
        });
    }

    public recordFNCBuild(): void {
        const project = this.projectDoc$();
        if (!project)
            return;

        void this._doStuff(async () => {
            const build = prompt("Enter a fortnite creative build code:");

            if (!build)
                return;

            const BUILDCODE_REGEX = new RegExp("^(\\d\\d\\d\\d-\\d\\d\\d\\d-\\d\\d\\d\\d)(\\??v=?(\\d+))?$");
            const m = build.match(BUILDCODE_REGEX);
            if (!m) {
                this.error$(`'${build}' is not a valid build code.`);
                return;
            }

            const code = m[1];
            let version = m[3] && parseInt(m[3]);
            if (version !== undefined && (typeof(version) !== "number" || !isFinite(version))) {
                this.error$(`'${build}' is not a valid build code (trouble parsing version).`);
                return;
            }

            if (!version)
                version = 1;

            await API.reportExternalBuild(project.projectId, code, version);
        });
    }

    public validatePublish(): void {
        const project = this.projectDoc$();
        if (!project)
            return;

            void this._doStuff(async () => {
                const build = prompt("Enter the build code to be validated:");

                if (!build)
                    return;

                const BUILDCODE_REGEX = new RegExp("^(\\d\\d\\d\\d-\\d\\d\\d\\d-\\d\\d\\d\\d)(\\??v=?(\\d+))?$");
                const m = build.match(BUILDCODE_REGEX);
                if (!m) {
                    this.error$(`'${build}' is not a valid build code.`);
                    return;
                }

                const code = m[1];
                let version = m[3] && parseInt(m[3]);
                if (version !== undefined && (typeof(version) !== "number" || !isFinite(version))) {
                    this.error$(`'${build}' is not a valid build code (trouble parsing version).`);
                    return;
                }

                if (!version)
                    version = 1;

                const result = await API.triggerValidatePublish(project.projectId, { code, version });
                if (result.status === "success")
                {
                    alert(`Build ${code}v${version} is valid for publish.`);
                }
                else if (result.status === "pending")
                {
                    alert(`Validation for build ${code}v${version} still pending.`);
                }
                else if (result.status === "failed")
                {
                    let message = `Build ${code}v${version} has failed validation and cannot be published...`;
                    for (const err of result.errors)
                        message = message + `<br/> Error: ${err.errorCode}, ${err.errorMessage}`;
                    this.error$(message);
                }
            });
    }

    public addVerseProjectAddress(): void {
        const project = this.projectDoc$();
        if (!project)
            return;

        void this._doStuff(async () => {
            const projectAddress = prompt("Enter a verse path you'd like to bind to this project (e.g. \"/me@epicgames.com/myproject\"):");
            if (!projectAddress)
                return;

            const res = await API.assignProjectAddress(project.projectId, projectAddress);
            this.projectAddresses$.push(res);
        });
    }

    public archiveProject(status: boolean): void {
        const project = this.projectDoc$();
        if (!project)
            return;

        void this._doStuff(async () => {
            if (status) {
                if (!confirm("Are you sure you want to archive this project? This will unstar the project for all users and remove it from the team list."))
                    return;
            }

            await API.setProjectArchiveStatus(project.projectId, status);
            window.location.reload();
        });
    }

    public deleteProject(): void {
        const project  = this.projectDoc$();
        if (!project)
            return;

        void this._doStuff(async () => {
            if (!confirm("Are you sure you want to delete this project? This action cannot be undone."))
                return;
            if (prompt("To confirm you wish to delete the project. Type 'DELETE' here.") !== "DELETE")
                return;

            await API.deleteProject(project.projectId);
            window.location.href = "/#/my-projects";
        });
    }

    public transferProject(): void {
        const project = this.projectDoc$();
        if (!project)
            return;

        void this._doStuff(async () => {
            let teamId = prompt("Enter the Team ID you would like to transfer this project to:");
            if (!teamId)
                return;
            if (teamId === "null")
                teamId = null; // this means take ownership

            const res = await API.transferProject(project.projectId, teamId);
            this.projectDoc$(res);
        });
    }

    public launchLink(linkCode: string, linkVersion: number): void {
        if (linkVersion > 0)
            linkCode += `v${linkVersion}`;

        void this._doStuff(async () => {
            if (!confirm(`Play ${linkCode} in Fortnite?\n\nAny Fortnite client where you are logged-in will immediately load this link code. If you are not logged-in, it will queue the code to run on next launch (expires in 15 min).`))
                return;

            const res: string = await API.launchLinkCode(linkCode);
            switch (res) {
                case "notified":
                    this.feedback$("Fortnite client contacted successfully.");
                    break;
                case "queued":
                    this.feedback$("Action queued. Launch Fortnite client now to continue...");
                    break;
                default:
                    throw new Error(`Unrecognized result status: ${res}`);
            }
        });
    }

    public unstageLink(linkCode: string): void {
        void this._doStuff(async () => {
            const info = await API.getIslandCodeInfo(linkCode);

            switch (info.linkState) {
                case "LIVE":
                    this.feedback$("This link is already live.");
                    return;

                case "STAGED":
                    if (!confirm(`Attempt to unstage ${linkCode}?\n\nDoing this will make this link publicly available.`))
                        return;

                    await API.unstageLinkCode(linkCode);

                    this.setSysMeta({ supports_link_restaging: true });
                    this.feedback$("This link is now live.");
                    break;

                case undefined:
                    this.feedback$("This link is already live.");
                    return;

                default:
                    this.error$(`Unknown ${info.linkState} link state.`);
                    break;
            }
        });
    }

    public restageLink(linkCode: string): void {
        void this._doStuff(async () => {
            const info = await API.getIslandCodeInfo(linkCode);

            switch (info.linkState) {
                case undefined:// FALL-THROUGH
                case "LIVE":
                    if (!confirm(`Attempt to restage ${linkCode}?\n\nDoing this will result in this link being pulled from public availability.`))
                        return;

                    await API.restageLinkCode(linkCode);
                    this.feedback$("This link is now staged.");
                    break;

                case "STAGED":
                    this.feedback$("This link is already staged.");
                    return;

                default:
                    this.error$(`Unknown ${info.linkState} link state.`);
                    break;
            }
        });
    }

    public blockPromoteBuildCode(shouldBlock: boolean): void {
        const project = this.projectDoc$();
        if (!project)
            return;

        void this._doStuff(async () => {
            if (project.sysMeta.block_promote_build_code) {
                if (!confirm("Are you sure you want to unlock the ability to promote buildcodes?")) {
                    return;
                }
            } else {
                if (!confirm("Are you sure you want to lock the ability to promote buildcodes?")) {
                    return;
                }
            }

            await API.blockPromoteBuildCode(project.projectId, shouldBlock);
            window.location.reload();
        });
    }

    public purgeUnpublishedProjectAddresses(): void {
        const project = this.projectDoc$();
        if (!project)
            return;

        void this._doStuff(async () => {
            const projectAddress = prompt("Enter a verse path you'd like to purge from this project (e.g. \"/me@epicgames.com/myproject\"):");
            if (!projectAddress)
                return;

            await API.purgeUnpublishedProjectAddresses(project.projectId, projectAddress);
            window.location.reload();
        });
    }

    public getProjectId(): string | undefined {
        return this.projectDoc$()?.projectId;
    }

    protected _saveHashState(): void {
        const projectId = this.form.projectId$() || this.projectDoc$()?.projectId;
        if (!projectId) {
            location.hash = "#/";
            return;
        }

        const oldHash = location.hash;
        const newHash = `#/${projectId}`;

        // prevent triggering unnecessary change events.
        if (newHash === oldHash)
            return;

        // we don't want to re-apply any state as a result of this change.
        $(window).off("hashchange", this._hashChangeFn);
        location.hash = newHash;
        setTimeout(() => $(window).one("hashchange", this._hashChangeFn));
    }

    public setStar(active: boolean): void {
        void this._doStuff(async () => {
            const projectInfo = this.projectInfo$();
            if (projectInfo === undefined)
                return; // invalid

            if (active) {
                if (projectInfo.hasStar)
                    return;
                await API.addStar(projectInfo.projectId);
                projectInfo.hasStar = true;
            } else {
                if (!projectInfo.hasStar && !projectInfo.isNew)
                    return;
                await API.removeStar(projectInfo.projectId);
                projectInfo.hasStar = false;
                projectInfo.isNew = false;
            }

            this.projectInfo$(projectInfo);
        });
    }

    public setActiveProjectDoc(targetContent?: string | ProjectDoc): void {
        void this._doStuff(async () => {

            if (!this.user.loggedIn$() && this.user.performLogin$())
                return;

            // ensure target content is a valid string or object.
            targetContent = targetContent || this.form.projectId$();
            if (!targetContent) {
                this.projectDoc$(undefined);
                return; // can't proceed.
            }

            // reduce targetContent into strongly typed constituents.
            const projectId = (typeof targetContent === "string") ? targetContent : targetContent.projectId;
            let projectDoc = (typeof targetContent === "string") ? undefined : targetContent;


            // make sure our form values are sync'd to the new target values before we begin.
            // note: final form values will ultimately be derrived from successfully returned data, we just want the ux to make sense in case data retrieval fails.
            this.form.projectId$(projectId);
            this.projectDoc$(projectDoc);
            this.projectInfo$(undefined);
            this.projectAddresses$([]);
            this.playtestCodes$([]);

            try {
                // fetch the content document if we weren't provided one.
                if (!projectDoc)
                    projectDoc = await API.getProjectDocument(projectId);
                this.projectInfo$(await API.getProjectUserInfo(projectId));
                const addresses = await API.getProjectAddresses(projectId);
                this.projectAddresses$(addresses);
                if (projectDoc.owner.type === "team") {
                    const playtestCodes = await API.getPlaytestCodes(projectId);
                    this.playtestCodes$(playtestCodes);
                }
            } finally {
                this.projectDoc$(projectDoc);
                this._saveHashState();
            }
        });
    }

    public goToInventory(): void {
        const projectDoc = this.projectDoc$();
        if (!projectDoc)
            return;

        window.location.href = `/inventory/#/${projectDoc.projectId}/@me`;
    }

    public allowModuleDeletion(): boolean {
        return this.projectInfo$()?.permissions.includes('vkcreateugcepicdeveloper') ?? false
    }

    public deleteModule(moduleId: string): void {

        // make sure user really wants to do this
        void this._doStuff(async () => {
            if (!confirm(`Are you sure you want to delete module ${moduleId}? This action cannot be undone.`))
                return;
            if (prompt("To confirm you wish to delete the module, type 'DELETE' here.") !== "DELETE")
                return;

            await API.purgeModule(moduleId);
            window.location.reload();
        });
    }

    private async _checkForWebClientPermissions(): Promise<void> {
        const webClientConfig = await API.getWebClientConfig();
        const { permissions } = webClientConfig;
        this.permissions$(permissions);
    }

    protected _applyHashState(): void {
        this.error$("");
        const [hash, projectId] = location.hash.split("/");
        this.form.projectId$(projectId);

        hash && this.setActiveProjectDoc(projectId);

        // re-apply the next time hash is changed.
        $(window).off("hashchange", this._hashChangeFn);
        $(window).one("hashchange", this._hashChangeFn);
    }

    /** does some work while the page is kept in the busy state, errors are parsed and bubbled up to the UI. */
    protected async _doStuff<T>(stuff: () => Promise<T>): Promise<T | undefined> {
        this._asyncTaskCnt++;
        this.error$("");
        this.feedback$("");
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