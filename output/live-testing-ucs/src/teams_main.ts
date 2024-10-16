import * as API from "@www/api";
import { parseErrorMessage } from "@www/util/errors";

import { TeamMembership } from "@app/types";

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

// expose API globally so we can monkey debug
window.API = API;

/** extend main view model with app specific fields and methods. */
class MainViewModel {

    public readonly newTeamModal: NewTeamModal;

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

    // teams form fields
    public readonly teamsForm = {
        next$: ko.computed<Date | undefined>(() => undefined),
        searchResults$: ko.observableArray<TeamMembership&{teamName: string}>([]),
        hasMore$: ko.observable<boolean>(false),
    };

    protected _teamsLimit = 0;
    protected _teamsTotal = 0;

    constructor() {
        // initialize component contexts.
        this.pageHeader = new PageHeader(this);
        this.newTeamModal = new NewTeamModal(this);

        void this.user.init().then(() => {
            // apply any state currently present in the hash.
            if (this.user.loggedIn$())
                this._applyHashState();
            else
                this.user.login();
        });
    }

    public openTeam(team: string): void {
        window.location.href = `/team/#/${team}`;
    }

    public loadMoreTeams(): Promise<void> {
        return this._doStuff(async () => {
            const q = await API.getMyTeams(this.teamsForm.next$());

            this._teamsLimit += q.limit;
            this._teamsTotal += q.results.length;

            ko.utils.arrayPushAll(this.teamsForm.searchResults$, q.results);
            this.teamsForm.hasMore$(this._teamsTotal >= this._teamsLimit);
        });
    }

    protected _applyHashState(): void {
        this.error$("");
        if (this._teamsTotal <= 0)
            void this.loadMoreTeams();

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