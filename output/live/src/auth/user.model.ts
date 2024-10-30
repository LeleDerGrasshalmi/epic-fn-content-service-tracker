/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-call */
type TokenDetail = {
    accountId: string;
    displayName: string;
    accessToken: string;
    exp: Date;
    authority: string;
}

export default class AuthUser
{
    /** true if token-detail has been acquired successfully. */
    public loggedIn$ = ko.observable<boolean>(false);

    /** true if initialization has completed. */
    public ready$ = ko.observable<boolean>(false);

    /** true if user should be redirected to oauth login. */
    public performLogin$ = ko.observable<boolean>(true);

    private _token_detail?: TokenDetail;

    public get accountId(): string { return this._token_detail ? this._token_detail.accountId : "" }
    public get displayName(): string { return this._token_detail ? this._token_detail.displayName : "" }
    public get accessToken(): string { return this._token_detail ? this._token_detail.accessToken : "" }
    public get authExpiry(): Date { return this._token_detail ? this._token_detail.exp : new Date() }

    public init = async (): Promise<void> =>
    {
        try
        {
            this._token_detail = await $.ajax(`/oauth/v1/token-detail`, { method: "GET" });

            if (this._token_detail?.exp)
                this._token_detail.exp = new Date(this._token_detail.exp);

            this.loggedIn$(true);
        }
        catch (ex)
        {
            console.error(ex);
            this.loggedIn$(false);

            const response = ex.responseJSON;

            if (response?.errorCode.endsWith(".invalid_auth")) {
                this.performLogin$(false);
            }
        }
        finally
        {
            this.ready$(true);
        }
    }

    public login = (): void =>
    {
        location.href = "/oauth/v1/login?fwd="+encodeURIComponent(window.location.href);
    }

    public logout = (): void =>
    {
        if (confirm("Do you really want to logout?"))
        {
            const popup = window.open("");
            const token = this._token_detail;
            if (popup && token)
            {
                // hack to attempt logging user out of epicgames.com
                popup.location.href = `${token.authority}/logout`;
                setTimeout(() => {
                    popup.close();
                    location.href = "/oauth/v1/logout";
                }, 200);
            }
            else
            {
                location.href = "/oauth/v1/logout";
            }
        }
    }
}