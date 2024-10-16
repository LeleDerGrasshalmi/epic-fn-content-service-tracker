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

    private _token_detail?: TokenDetail;

    public get accountId() { return this._token_detail ? this._token_detail.accountId : "" };
    public get displayName() { return this._token_detail ? this._token_detail.displayName : "" };
    public get accessToken() { return this._token_detail ? this._token_detail.accessToken : "" };
    public get authExpiry() { return this._token_detail ? this._token_detail.exp : new Date() };

    public init = async () =>
    {
        try
        {
            this._token_detail = await $.ajax(`/oauth/v1/token-detail`, { method: "GET" });

            if (this._token_detail && this._token_detail.exp)
                this._token_detail.exp = new Date(this._token_detail.exp);

            this.loggedIn$(true);
        }
        catch (ex)
        {
            console.error(ex);
            this.loggedIn$(false);
        }
        finally
        {
            this.ready$(true);
        }
    }

    public login = () =>
    {
        location.href = "/oauth/v1/login?fwd="+encodeURIComponent(window.location.href);
    }

    public logout = async () =>
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