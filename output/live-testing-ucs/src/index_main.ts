/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as API from "@www/api";
import { parseErrorMessage } from "@www/util/errors";

import { ProjectSearchResultSlim, TeamMembership } from "@app/types";
import { MappedObservable, toMappedObservable, toMappedObservableArray } from "@www/util/ko";

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

import NewProjectModal from "@www/components/new-project-modal";
NewProjectModal.RegisterComponents(config);

// expose API globally so we can monkey debug
window.API = API;

interface ProjectList {
    team: string;
    results: ProjectSearchResultSlim[];
    searched: number;
}

/** extend main view model with app specific fields and methods. */
class MainViewModel {
    public readonly newProjectModal: NewProjectModal;

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

    /** (COMMON) refences the page's location.hashchange event delegate. */
    protected _hashChangeFn = (): void => this._applyHashState();

    /** tracks the page's form field observables. */
    public readonly form = {
        tab$: ko.observable<"myProjects" | "allProjects">("myProjects"),
        focusTeam$: ko.observable<string>("@personal"),
        showArchived$: ko.observable<boolean>(false),
    };

    public readonly teamsForm = {
        searchResults$: ko.observableArray<TeamMembership & { teamName: string }>([]),
        hasMore$: ko.observable<boolean>(true),
        _searched: 0,
    };

    private _projectLists = new Map<string, ProjectList>();
    private _activeList: ProjectList;

    // projects form fields
    public readonly projectsForm = {
        searchResults$: ko.observableArray<MappedObservable<ProjectSearchResultSlim>>([]),
        hasMore$: ko.observable<boolean>(true),
    };

    constructor() {
        // initialize component contexts.
        this.pageHeader = new PageHeader({
            busy$: this.busy$,
            user: this.user,
        });
        this.newProjectModal = new NewProjectModal({
            busy$: this.busy$,
            openProject: (projectId: string): void => {
                window.location.href = `/project/#/${projectId}`;
            },
        });

        // pre-populate cache
        const starredProjects = { team: "@starred", results: [], searched: 0 };
        const personalProjects = { team: "@personal", results: [], searched: 0 };
        this._activeList = starredProjects;
        this._projectLists.set(starredProjects.team, starredProjects);
        this._projectLists.set(personalProjects.team, personalProjects);

        void this.user.init().then(() => {
            if (!this.user.loggedIn$()) {
                this.user.login();
                return;
            }

            // load teams in the BG
            this.loadMoreTeams();

            // apply any state currently present in the hash.
            this._applyHashState();
        });
    }

    public loadMoreTeams(): void {
        void this._doStuff(async () => {
            const teams = this.teamsForm.searchResults$();

            let olderThan: Date | undefined;
            if (teams.length > 0)
                olderThan = teams[teams.length - 1].updated;
            const q = await API.getMyTeams(olderThan);
            this.teamsForm._searched += q.limit;
            for (const t of q.results)
                teams.push(t);

            this.teamsForm.searchResults$(teams);
            this.teamsForm.hasMore$(teams.length >= this.teamsForm._searched);
        });
    }

    public toggleArchived(): void {
        const archived = !this.form.showArchived$();
        this.form.showArchived$(archived);

        // refresh state if needed
        if (this.form.tab$() === "allProjects") {
            let hash = "#/all-projects/" + this.form.focusTeam$();
            if (archived)
                hash += "/archived";
            location.hash = hash;
            this._resetList();
        }
    }

    public setFormTab(tab: "myProjects" | "allProjects"): void {
        if (tab === "allProjects") {
            let hash = "#/all-projects/" + this.form.focusTeam$();
            if (this.form.showArchived$())
                hash += "/archived";
            location.hash = hash;
        } else {
            if (this.form.tab$() === "myProjects")
                this._resetList();
            location.hash = "#/my-projects";
        }
    }

    private _resetList(): void {
        this.projectsForm.searchResults$([]);
        this.projectsForm.hasMore$(true);
        this._activeList.results = [];
        this._activeList.searched = 0;
        void this.loadMoreProjects();
    }

    public setFocusTeam(teamId: string): void {
        if (this.form.focusTeam$() === teamId)
            this._resetList();
        let hash = "#/all-projects/" + teamId;
        if (this.form.showArchived$())
            hash += "/archived";
        location.hash = hash;
    }

    public setStar(projectId: string, active: boolean): void {
        void this._doStuff(async () => {
            const projectInfoList = this.projectsForm.searchResults$();
            const projectInfoIdx = projectInfoList.findIndex((x => x.projectId$() === projectId));
            const projectInfo = projectInfoList[projectInfoIdx];
            const projectRaw = this._activeList.results[projectInfoIdx];
            if (projectInfo === undefined)
                return; // invalid

            if (active) {
                if (projectInfo.is_starred$())
                    return; // nothing to do
                await API.addStar(projectId);
                projectInfo.is_starred$(true);
            } else {
                if (!projectInfo.is_starred$() && !projectInfo.is_new$())
                    return; // nothing to do
                await API.removeStar(projectId);
                projectInfo.is_starred$(false);
                projectInfo.is_new$(false);
            }

            const wasNew = projectRaw.is_new;

            // update the cache
            let updatedStarred = false;
            for (const list of this._projectLists.values()) {
                for (const proj of list.results) {
                    if (proj.projectId === projectId) {
                        // update the record
                        if (active)
                            proj.is_starred = true;
                        else
                            proj.is_new = proj.is_starred = false;

                        // see if this is on the starred list
                        if (list.team === "@starred")
                            updatedStarred = true;
                    }
                }
            }

            // if we starred this, add it to the top of our starred list
            if (active) {
                if (!updatedStarred) {
                    const starredList = this._projectLists.get("@starred");
                    if (!starredList)
                        throw new Error("failed updating starred list.");

                    starredList.results.unshift({ ...projectRaw });
                    starredList.searched += 1;
                }
            }

            // if we're removing a new. clear it, otherwise let it sit (re-star)
            if (!active && wasNew) {
                // update KO
                this.projectsForm.searchResults$.splice(projectInfoIdx, 1);

                // update the cache
                this._activeList.results.splice(projectInfoIdx, 1);
                this._activeList.searched -= 1;
            } else {
                // update KO
                this.projectsForm.searchResults$.splice(projectInfoIdx, 1, projectInfo);
            }
        });
    }

    public launchLink(linkCode: string): void {
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

    private _projectsLoading = false;

    public loadMoreProjects(): Promise<void> {
        if (this._projectsLoading)
            return Promise.resolve();
        this._projectsLoading = true;
        return this._doStuff(async () => {
            let olderThan: Date | undefined;
            if (this._activeList.results.length > 0)
                olderThan = this._activeList.results[this._activeList.results.length - 1].date;

            const q = this._activeList.team === "@starred" ?
                await API.getStarredProjects(olderThan) :
                await API.getTeamProjects(this._activeList.team, olderThan, this.form.showArchived$() ? "archived" : undefined);

            this._activeList.searched += q.limit;
            for (const r of q.results) {
                this._activeList.results.push(r);
                this.projectsForm.searchResults$.push(toMappedObservable(r));
            }
            this.projectsForm.hasMore$(this._activeList.results.length >= this._activeList.searched);
        }).finally(() => {
            this._projectsLoading = false;
        });
    }

    protected _applyHashState(): void {
        $(window).off("hashchange", this._hashChangeFn);
        this.error$("");

        if (location.hash.startsWith("#/all-projects/")) {
            const segments = location.hash.split("/");
            const teamId = segments[2];
            const archived = (segments[3] === "archived");
            this.form.tab$("allProjects");
            this.form.focusTeam$(teamId);
            this.form.showArchived$(archived);

            // get a cached project list
            let teamCache = this._projectLists.get(teamId);
            if (teamCache === undefined) {
                teamCache = { team: teamId, results: [], searched: 0 };
                this._projectLists.set(teamCache.team, teamCache);
            }
            this._activeList = teamCache;
        } else {
            location.hash = "#/my-projects";
            this.form.tab$("myProjects");

            // actvate the starred list
            const starred = this._projectLists.get("@starred");
            if (!starred)
                throw new Error("failed activating starred list");

            this._activeList = starred;

            // trim any unstarred projects in the cache
            this._activeList.results = this._activeList.results.filter((val) => {
                if (val.is_starred || val.is_new)
                    return true;
                this._activeList.searched -= 1;
                return false;
            });
        }

        // update the search results
        this.projectsForm.searchResults$(toMappedObservableArray(this._activeList.results));
        this.projectsForm.hasMore$(this._activeList.results.length >= this._activeList.searched);

        // search more if needed
        if (this._activeList.searched <= 0)
            void this.loadMoreProjects();

        // re-apply the next time hash is changed.
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
        } catch (err) {
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