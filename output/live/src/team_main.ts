/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as API from "@www/api";
import { parseErrorMessage } from "@www/util/errors";
import { MappedObservable, toMappedObservableArray, toMappedObservable } from "@www/util/ko";

import {
    ProjectSearchResultSlim,
    AccountInfo,
    TeamMembership,
    AccessControl,
    EmailDomain,
    TeamDoc,
    PlaytestGroup,
    PlaytestGroupMembership,
    TeamMemberPrefs,
    WorkspaceDoc,
} from "@app/types";

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

import NewTeamModal from "@www/components/new-team-modal";
NewTeamModal.RegisterComponents(config);

import EditTeamDomainModal from "@www/components/edit-team-domain-modal";
EditTeamDomainModal.RegisterComponents(config);

import EditTeamMembershipModal from "@www/components/edit-team-membership-modal";
EditTeamMembershipModal.RegisterComponents(config);

import EditTeamWorkspaceModal from "@www/components/edit-team-workspace-modal";
EditTeamWorkspaceModal.RegisterComponents(config);

import { ViewSysMetaModal } from "@www/components/view-metadata-modal";
ViewSysMetaModal.RegisterComponents(config);

import MetaEditor from "@www/components/meta-editor/meta-editor";
MetaEditor.RegisterComponents(config);

// expose API globally so we can monkey debug
window.API = API;

const BASIC_ACCESS : Omit<AccessControl,"read"> = { edit: false, operate: false, publish: false, admin: false };
const DEFAULT_PREFS : TeamMemberPrefs = {
    watchTeam: true,
};

/** extend main view model with app specific fields and methods. */
class MainViewModel {
    public readonly newTeamModal: NewTeamModal;

    public readonly editTeamDomainModal: EditTeamDomainModal;

    public readonly editTeamMembershipModal: EditTeamMembershipModal;

    public readonly editTeamWorkspaceModal: EditTeamWorkspaceModal;

    public readonly viewSysMetaModal: ViewSysMetaModal;

    /** (COMMON) tracks the number of active async tasks. */
    protected _asyncTaskCnt = 0;

    /** (COMMON) shared page header. */
    public readonly pageHeader: PageHeader;

    /** (COMMON) refences the page's location.hashchange event delegate. */
    protected _hashChangeFn = (): Promise<void> => this._applyHashState();

    /** (COMMON) tracks authenticated user. */
    public readonly user = new AuthUser();

    /** (COMMON) tracks the page's busy state. */
    public readonly busy$ = ko.observable<boolean>(false);

    /** (COMMON) tracks the page's current error text. */
    public readonly error$ = ko.observable<string>("");
    public readonly feedback$ = ko.observable<string>("");

    /** tracks the teamId being managed by this page.  */
    public readonly teamId$ = ko.observable<string>("");

    /** tracks info being rendered by this page.  */
    public readonly teamDoc$ = ko.observable<TeamDoc|null>(null);
    /** tracks current user's team membership status. */
    public readonly membership$ = ko.observable<TeamMembership|null>(null);
    /** tracks the entire result of our my teams call */
    public readonly result$ = ko.observable<API.TeamMembershipResult>();

    /** tracks whether we are listing team projects or members */
    public readonly listView$ = ko.observable<"projects" | "members" | "workspaces" | "domains" | "playtesters" | "playtest_groups">("projects");

    /** true if the current user is eligible to join the current team */
    public readonly canJoinTeam$ = ko.computed<boolean>(() => false);
    public readonly prefs$ = ko.observable<MappedObservable<TeamMemberPrefs>>(toMappedObservable(DEFAULT_PREFS));

    /** true if the current user is eligible to leave the current team. */
    public readonly canLeaveTeam$ = ko.computed<boolean>(() => false);

    // can the user update sysMeta
    public readonly hasSysMetaUpdateAccess$ = ko.observable<boolean|undefined>(false);

    // can the user use team workspaces
    public readonly hasTeamWorkspaceAccess$ = ko.observable<boolean|undefined>(false);

    // is the user kws adult verified.
    public readonly isAdultVerified$ = ko.observable<boolean>(false);

    /** tracks current user's account info */
    protected accountInfo$ = ko.observable<AccountInfo>();

    // form fields
    public readonly projectsForm = {
        next$: ko.computed<Date | undefined>(() => undefined),
        searchResults$: ko.observableArray<MappedObservable<ProjectSearchResultSlim>>([]),
        hasMore$: ko.observable<boolean>(false),
    };

    public readonly membersForm = {
        searchResults$: ko.observableArray<MappedObservable<TeamMembership&{accountName:string}>>([]),
    };

    public readonly workspacesForm = {
        searchResults$: ko.observableArray<MappedObservable<WorkspaceDoc&{creatorName:string}>>([]),
    };

    public readonly playtestersForm = {
        playtestGroups$: ko.observableArray<{ id: string, name: string }>([]),
        selectedGroup$: ko.observable<string>(),
        searchResults$: ko.observableArray<MappedObservable<PlaytestGroupMembership & { accountName: string }>>([]),
    };

    public readonly domainsForm = {
        emailDomains$: ko.observableArray<EmailDomain>([]),
    };

    protected _membersLimit = 0;
    protected _membersTotal = 0;

    protected _workspacesLimit = 0;
    protected _workspacesTotal = 0;

    protected _playtestersLimit = 0;
    protected _playtestersTotal = 0;

    protected _projectLimit = 0;
    protected _projectTotal = 0;

    constructor() {
        this.pageHeader = new PageHeader(this);
        this.newTeamModal = new NewTeamModal(this);
        this.editTeamDomainModal = new EditTeamDomainModal(this);
        this.editTeamMembershipModal = new EditTeamMembershipModal(this);
        this.editTeamWorkspaceModal = new EditTeamWorkspaceModal(this);
        this.viewSysMetaModal = new ViewSysMetaModal("team", this);

        void this.user.init().then(() => {
            if (!this.user.loggedIn$() && this.user.performLogin$())
                this.user.login();

            void this._applyHashState();
            void this._checkForWebClientPermissions();

            void this._doStuff(async () => {
                const status = await API.getKwsVerificationStatuses();
                this.isAdultVerified$(status.av);
            });
        });

        this.projectsForm.next$ = ko.computed(() => {
            const results = this.projectsForm.searchResults$();
            const last = results[results.length - 1];
            if (!last)
                return undefined;
            return moment(last.date$()).toDate();
        });

        this.canJoinTeam$ = ko.computed(() => {
            const membership = this.membership$();
            if (membership) return false;

            const email = this.accountInfo$()?.email;
            if (!email) return false;

            const team = this.result$();
            if (!team) return false;

            return team.publicProps.emailDomains.map(x => x.domain).includes(`@${email.split("@")[1]}`);
        });

        this.canLeaveTeam$ = ko.computed(() => {
            const userId = this.user.accountId;
            if (!userId) return false;

            const team = this.result$();
            if (!team) return false;

            return team.owner.id !== userId;
        });

        // reset lists whenever view changes.
        this.listView$.subscribe(view => {
            switch (view) {
                case "domains":
                case "playtest_groups":
                    return;

                case "members":
                    this._memberLoad = undefined;
                    void this.loadAllMembers();
                    return;

                case "workspaces":
                    this._workspaceLoad = undefined;
                    void this.loadAllWorkspaces();
                    return;

                case "playtesters":
                {
                    const team = this.teamDoc$();
                    if (team) {
                        this.playtestersForm.playtestGroups$(team.playtestGroups.map((ptg) => {
                            return { id: ptg.playtestGroupId, name: ptg.name };
                        }));
                        if (this.playtestersForm.playtestGroups$().length > 0)
                            void this.loadAllPlaytesters(this.playtestersForm.playtestGroups$()[0].id);
                    }
                    return;
                }

                case "projects":
                    void this.loadMoreProjects(true);
                    return;
            }
        });
    }

    public openModule(moduleId: string): void {
        window.location.href = `/module/#/${moduleId}`;
    }

    public openProject(project: string): void {
        window.location.href = `/project/#/${project}`;
    }

    public openTeam(team: string): void {
        window.location.href = `/team/#/${team}`;
    }

    public startKwsAdultVerification(): void {
        void this._doStuff(async() => {
            const rsp = await API.startKwsAdultVerification();
            window.open(rsp.redirect);
        });
    }

    public setStar(projectId: string, active: boolean): void {
        void this._doStuff(async () => {
            const projectInfoList = this.projectsForm.searchResults$();
            const projectInfoIdx = projectInfoList.findIndex((x => x.projectId$() === projectId));
            const projectInfo = projectInfoList[projectInfoIdx];
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

            this.projectsForm.searchResults$.splice(projectInfoIdx, 1, projectInfo);
        });
    }

    public isTeamOwner(target: TeamMembership): boolean {
        return target.accountId === this.result$()?.owner.id;
    }

    public loadTeamInfo(): Promise<void> {
        const teamId = this.teamId$();
        if (!teamId)
            window.location.href = "/";

        return this._doStuff(async () => {
            const q = await API.getTeamMembership(teamId);
            if (!q.membership)
                await this.getAccountInfo$(); // we will need this

            this.result$(q);
            this.teamDoc$(q.team);
            if (q.team)
                this.playtestersForm.playtestGroups$(q.team.playtestGroups.map((ptg) => {
                    return { id: ptg.playtestGroupId, name: ptg.name };
                }));
            this.membership$(q.membership);
            this.prefs$(toMappedObservable(q.membership?.prefs || DEFAULT_PREFS));
            this.domainsForm.emailDomains$(q.publicProps.emailDomains);
        });
    }

    public async getAccountInfo$(): Promise<void> {
        if (!this.user.accountId) {
            this.accountInfo$(undefined);
            return;
        }

        const info = await API.getAccountInfoByIdWithEmail(this.user.accountId);
        this.accountInfo$(info);
    }

    public getSysMeta(): { sysMeta: Record<string, unknown>, docId: string } | undefined {
        const contentDoc = this.teamDoc$();
        if (!contentDoc)
            return undefined;
        return { sysMeta: contentDoc.sysMeta, docId: contentDoc.teamId };
    }

    public setSysMeta(sysMeta: Record<string,unknown>): void {
        const doc = this.teamDoc$();
        if (!doc)
            throw new Error("faild to load team doc");

        const newContent = { ...doc, sysMeta };
        this.teamDoc$(newContent);
    }

    public loadMoreProjects(reset = false): Promise<void> {
        const teamId = this.teamId$();
        if (!teamId)
            window.location.href = "/";

        if (reset) {
            this.projectsForm.hasMore$(false);
            this.projectsForm.searchResults$([]);
            this._projectLimit = 0;
            this._projectTotal = 0;
        }

        return this._doStuff(async () => {
            const q = await API.getTeamProjects(this.teamId$(), this.projectsForm.next$());

            this._projectLimit += q.limit;
            this._projectTotal += q.results.length;

            ko.utils.arrayPushAll(this.projectsForm.searchResults$, toMappedObservableArray(q.results));
            this.projectsForm.hasMore$(this._projectTotal >= this._projectLimit);
        });
    }

    private _memberLoad : Promise<void>|undefined;

    public loadAllMembers(): Promise<void> {
        const teamId = this.teamId$();
        if (!teamId)
            window.location.href = "/";

        if (this._memberLoad)
            return this._memberLoad;

        let hasMore = true;
        let next = "";
        this.membersForm.searchResults$([]);
        this._membersLimit = 0;
        this._membersTotal = 0;

        return this._memberLoad = this._doStuff(async () => {
            while (hasMore) {
                const q = await API.getTeamMembers(this.teamId$(), 100, next);

                this._membersLimit += q.limit;
                this._membersTotal += q.results.length;

                ko.utils.arrayPushAll(this.membersForm.searchResults$, toMappedObservableArray(q.results));
                hasMore = this._membersTotal >= this._membersLimit;
                if (q.results.length > 0)
                    next = q.results[q.results.length-1].og_name;
            }
        });
    }

    private _workspaceLoad : Promise<void>|undefined;

    public loadAllWorkspaces(refresh = false): Promise<void> {
        const teamId = this.teamId$();
        if (!teamId)
            window.location.href = "/";

        if (!refresh && this._workspaceLoad)
            return this._workspaceLoad;

        let hasMore = true;
        let next = "";
        this.workspacesForm.searchResults$([]);
        this._workspacesLimit = 0;
        this._workspacesTotal = 0;

        return this._workspaceLoad = this._doStuff(async () => {
            while (hasMore) {
                const q = await API.findWorkspacesByOwner(teamId, 100, next);

                this._workspacesLimit += q.limit;
                this._workspacesTotal += q.results.length;

                ko.utils.arrayPushAll(this.workspacesForm.searchResults$, toMappedObservableArray(q.results));
                hasMore = this._workspacesTotal >= this._workspacesLimit;
                if (q.results.length > 0)
                    next = q.results[q.results.length-1].name;
            }
        });
    }

    public getWorkspaceName(workspaceId: string): string
    {
        for(const ws of this.workspacesForm.searchResults$())
        {
            if (ws.workspaceId$() === workspaceId)
                return ws.name$();
        }

        return workspaceId;
    }

    public deleteWorkspace(workspaceId: string, name: string): Promise<void> {
        if (!workspaceId)
            return Promise.resolve();

        if (!confirm(`Are you sure you want to delete the workspacedoc "${name}"?`))
            return Promise.resolve();

        return this._doStuff(async () => {
            await API.deleteWorkspace(workspaceId);
            this._workspaceLoad = undefined;
            return this.loadAllWorkspaces();
        });
    }

    public loadAllPlaytesters(groupId: string): Promise<void> {
        const teamId = this.teamId$();
        if (!teamId)
            window.location.href = "/";

        let hasMore = true;
        let next = "";
        this.playtestersForm.selectedGroup$(groupId);
        this.playtestersForm.searchResults$([]);
        this._playtestersLimit = 0;
        this._playtestersTotal = 0;

        return this._doStuff(async () => {
            while (hasMore) {
                const q = await API.getTeamPlaytesters(this.teamId$(), groupId, 100, next);

                this._playtestersLimit += q.limit;
                this._playtestersTotal += q.results.length;

                ko.utils.arrayPushAll(this.playtestersForm.searchResults$, toMappedObservableArray(q.results));
                hasMore = this._playtestersTotal >= this._playtestersLimit;
                if (q.results.length > 0)
                    next = q.results[q.results.length-1].accountId;
            }
        });
    }

    public updatePrefs(): void {
        const teamId = this.teamId$();
        if (!teamId) return;
        const membership = this.membership$();
        if (!membership) return;

        let same = true;
        const prefs = this.prefs$().unmap();
        for (const k in prefs) {
            const key : keyof(TeamMemberPrefs) = k as any;
            if (prefs[key] !== membership.prefs[key]) {
                same = false;
                break;
            }
        }

        if (!same) {
            console.log("updating preferences", prefs);
            void this._doStuff(async () => {
                await API.updateTeamMemberPrefs(teamId, prefs);
            });
        }
    }

    public respondToInvite(accept: boolean): void {
        const teamId = this.teamId$();
        if (!teamId) return;

        void this._doStuff(async () => {
            if (accept) {
                const prefs = this.prefs$().unmap();
                await API.acceptInvitation(teamId, prefs);
            } else {
                await API.rejectInvitation(teamId);
            }
            window.location.reload();
        });
    }

    public async leaveTeam(accountId: string): Promise<void> {
        if (!accountId) return;

        const team = this.result$();
        if (!team) return;

        const verb = accountId === this.user.accountId
            ? "leave"
            : "remove user from";

        if (!confirm(`Are you sure you want to ${verb} team: ${team.publicProps.name}?`))
            return;

        await this._doStuff(async () => {
            await API.removeTeamMember(team.teamId, accountId);
            window.location.reload();
        });
    }

    public addMember(): void {
        const team = this.result$();
        if (!team)
            return;

        this.listView$("members");
        this.loadAllMembers().finally(() => {
            // let the page UI update
            setTimeout(() => {
                // get the account ID
                const accountParam = prompt("Enter the account ID (e.g. 25c1e322a93a4b42b880bac3bd0918e4):");
                if (!accountParam)
                    return;
                const accountId = accountParam.trim().toLowerCase();
                if (!accountId)
                    return;

                // see if they're already a member
                for (const mem of this.membersForm.searchResults$()) {
                    if (mem.accountId$() === accountId) {
                        if (mem.status$() === "pending") {
                            this.feedback$(`User '${mem.name$()}' invited successfully.\nNow send them this URL which they can use to accept the invite:\n${window.location.href}`);
                        } else {
                            this.feedback$(`User '${mem.name$()}' is already a team member.`);
                        }
                        return;
                    }
                }

                // get the name
                const nameParam = prompt("Enter the member's name (e.g. 'John Doe'):\n\n(as they should be known to the rest of the team)");
                if (!nameParam)
                    return;
                const memberName = nameParam.trim();
                if (!memberName)
                    return;

                // do the operation
                void this._doStuff(async () => {
                    const membership = await API.upsertTeamMember(team.teamId, accountId, memberName, { edit: true });
                    this.membersForm.searchResults$.unshift(toMappedObservable(membership));

                    this.feedback$(`User '${memberName}' invited successfully.\nNow send them this URL which they can use to accept the invite:\n${window.location.href}`);
                });
            }, 100);
        });
    }

    public addDomain(): void {
        const team = this.result$();
        if (!team)
            return;

        const domainParam = prompt("Domain (e.g. '@epicgames.com'", "@");
        if (!domainParam)
            return;

        const domain = domainParam.toLowerCase().trim();
        if (!domain.startsWith("@"))
            return alert("Please start your domain with @");
        const STUPID_DOMAINS_TO_ADD : string[] = [
            "@aim.com",
            "@aol.com",
            "@gmail.com",
            "@gmx.com",
            "@hotmail.com",
            "@icloud.com",
            "@juno.com",
            "@live.com",
            "@mac.com",
            "@mail.com",
            "@mailinator.com",
            "@msn.com",
            "@outlook.com",
            "@pm.com",
            "@protonmail.com",
            "@yahoo.com",
        ];
        if (STUPID_DOMAINS_TO_ADD.includes(domain))
            return alert(`Please only use this feature to enable joining from domains you control. You clearly don't own ${domain}.`);

        void this._doStuff(async () => {
            const emailDomains = [...team.publicProps.emailDomains, { domain, access: BASIC_ACCESS }];
            await API.editTeamProperties(team.teamId, { ...team.publicProps, emailDomains });
            window.location.reload();
        });
    }

    public removePlaytester(accountId: string): void {
        const groupId = this.playtestersForm.selectedGroup$();
        if (!groupId)
            return;
        if (!confirm("Are you sure you want to remove this account as a playtester?"))
            return;
        void this._doStuff(async () => {
            await API.removePlaytester(this.teamId$(), groupId, accountId);
            for (const match of this.playtestersForm.searchResults$()) {
                if (match.accountId$() === accountId)
                    this.playtestersForm.searchResults$.remove(match);
            }
        });
    }

    public addGroup(): void {
        const team = this.teamDoc$();
        if (!team)
            return;
        const name = prompt("Enter a name for the playtest group:");
        if (!name)
            return;
        void this._doStuff(async () => {
            const ptg = await API.createPlaytestGroup(team.teamId, name);
            team.playtestGroups.push(ptg);
            this.teamDoc$(team);
        });
    }

    public removeGroup(groupId: string): void {
        const team = this.teamDoc$();
        if (!team)
            return;
        if (!confirm("Are you sure you want to delete this group (and drop all its members)?\nThis action cannot be undone."))
            return;
        void this._doStuff(async () => {
            await API.removePlaytestGroup(team.teamId, groupId);
            for (let i=0;i<team.playtestGroups.length;++i) {
                if (team.playtestGroups[i].playtestGroupId === groupId)
                    team.playtestGroups.splice(i, 1);
            }
            this.teamDoc$(team);
        });
    }

    public addJoinCode(ptg: PlaytestGroup): void {
        const teamCheck = this.teamDoc$();
        if (!teamCheck)
            return;
        const team = teamCheck;
        const noteStr = prompt("Enter an optional note for the code (private, for your reference).");
        if (noteStr === null)
            return;
        const limitStr = prompt("How many charges should this code have? (enter 0 for unlimited)", "1");
        if (limitStr === null)
            return;
        const limit = parseInt(limitStr || "");
        if (isNaN(limit) || limit < 0) {
            alert("invalid limit "+limitStr);
            return;
        }

        void this._doStuff(async () => {
            const newGroup = await API.createJoinCode(team.teamId, ptg.playtestGroupId, {
                code: "", // ask the backend to make a UUID
                note: noteStr,
                charges: {
                    consumed: 0,
                    limit
                }
            });
            console.log(newGroup);
            for (let i=0;i<team.playtestGroups.length;++i) {
                if (team.playtestGroups[i].playtestGroupId === newGroup.playtestGroupId) {
                    team.playtestGroups[i] = newGroup;
                    break;
                }
            }
            this.teamDoc$(team);
        });
    }

    public removeJoinCode(code: string): void {
        const teamCheck = this.teamDoc$();
        if (!teamCheck)
            return;
        const team = teamCheck;

        for (const ptg of team.playtestGroups) {
            for (let i=0;i<ptg.joinCodes.length;++i) {
                const code_def = ptg.joinCodes[i];
                if (code_def.code === code) {
                    if (code_def.charges.limit <= 0 || code_def.charges.consumed < code_def.charges.limit) {
                        if (!confirm(`Are you sure you want to remove ${code}. Players will no longer be able to use it to join '${ptg.name}'.`))
                            return;
                    }

                    void this._doStuff(async () => {
                        await API.removeJoinCode(team.teamId, ptg.playtestGroupId, code);
                        ptg.joinCodes.splice(i, 1);
                        this.teamDoc$(team);
                    });
                    return;
                }
            }
        }
    }

    public async transferTeam(): Promise<void> {
        const team = this.teamDoc$();
        if (!team)
            return;

        await this._doStuff(async () => {
            let accountId = prompt("Enter the Account ID you would like to transfer this team to:");
            if (!accountId)
                return;
            if (accountId === "null") {
                // this means take ownership (superuser)
                const myAccountId = this.accountInfo$();
                if (!myAccountId)
                    return;
                accountId = myAccountId.id;
            }

            const res = await API.transferTeamToUser(team.teamId, accountId);
            this.teamDoc$(res);
        });
    }

    public async deleteTeam(): Promise<void> {
        const team = this.teamDoc$();
        if (!team)
            return;

        await this._doStuff(async () => {
            if (!confirm("Are you sure you want to delete this team? This action cannot be undone."))
                return;
            if (prompt("To confirm you wish to delete the team, type 'DELETE' here.") !== "DELETE")
                return;

            await API.deleteTeam(team.teamId);
            window.location.href = "/#/teams";
        })
    }

    public makeCodeUrl(code: string): string {
        const teamId = this.result$()?.teamId;
        if (!teamId)
            return "javascript:alert('invalid')";
        return `/join-playtest/#/${encodeURIComponent(teamId)}/${encodeURIComponent(code)}`;
    }

    public removeDomain(target: EmailDomain): void {
        if (!confirm(`Are you sure you want to remove the pre-authorized domain: ${target.domain}?`))
            return;

        const team = this.result$();
        if (!team)
            return;

        const emailDomains = team.publicProps.emailDomains.filter(d => d.domain !== target.domain);
        void this._doStuff(async () => {
            await API.editTeamProperties(team.teamId, { ...team.publicProps, emailDomains });
            window.location.reload();
        });
    }

    public hasAccess(name: "playtest" | "read" | "edit" | "operate" | "publish" | "admin" | "owner", source: "membership" | "domain" = "membership", target?: TeamMembership | EmailDomain): boolean {
        let accessControl : AccessControl|undefined;

        switch (source) {
            case "membership":
            {
                const membership = (target || this.membership$()) as TeamMembership | undefined;
                if (membership) {
                    // developer
                    accessControl = { read: true, ...membership.access };
                }
                break;
            }
            case "domain":
                if (target !== undefined) {
                    accessControl = { read: true, ...target.access };
                } else {
                    const team = this.result$();
                    const email = this.accountInfo$()?.email;
                    if (email && team) {
                        const domainMatch = team.publicProps.emailDomains.filter(x => x.domain === `@${email.split("@")[1]}`)[0];
                        if (domainMatch) {
                            // developer
                            accessControl = { read: true, ...domainMatch.access };
                        }
                    }
                }
                break;
        }

        switch(name) {
            case "playtest":
                return !!accessControl;

            case "read":
                return !!accessControl?.read;

            case "edit":
                return !!accessControl?.edit;

            case "operate":
                return !!accessControl?.operate;

            case "publish":
                return !!accessControl?.publish;

            case "admin":
                return !!accessControl?.admin;

            case "owner":
                return !!accessControl?.owner;

            default:
                throw new Error(`hasAccess does not define permission with name: ${name as string}`);
        }
    }

    private async _checkForWebClientPermissions(): Promise<void> {
        const webClientConfig = await API.getWebClientConfig();
        const { permissions } = webClientConfig;
        this.hasSysMetaUpdateAccess$(permissions.canUpdateSysMeta);
        this.hasTeamWorkspaceAccess$(permissions.canUseTeamWorkspaces);
    }

    protected async _applyHashState(): Promise<void> {
        this.error$("");
        const [hash, teamId] = location.hash.split("/");

        hash && this.teamId$(teamId);

        await this.loadTeamInfo();
        const membership = this.membership$();

        if (membership && membership.status === "accepted" && membership.access) {
            void this.loadMoreProjects(true);
        }

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