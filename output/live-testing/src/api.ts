/* eslint-disable */
import type {
    WebClientConfig,
    CookVersionSelector,
    PagedResults,
    ModuleSearchResult,
    BuildVersion,
    CookVersionSelectorGroup,
    ProjectUserInfo,
    GenPackageRequest,
    ProjectDoc,
    ModuleDoc,
    CreateModuleRequest,
    CreateProjectRequest,
    UploadModuleVersionRequest,
    ModuleDependency,
    ManifestEntry,
    ProjectSearchResultSlim,
    ModuleVersionDocWithArtifacts,
    Inventory,
    GetInventorySetResponse,
    InventoryEdit,
    AccountInfo,
    ProjectSnapshot,
    ResolvedContent,
    VersionedLinkCode,
    TeamDoc,
    TeamMembership,
    AccessControl,
    TeamProperties,
    ArtifactCookResult,
    ValidationResult,
    IslandCodeInfo,
    GenerateBuildcodeRequest,
    PublishedLink,
    PlaytestJoinCode,
    PlaytestGroup,
    PlaytestGroupMembership,
    JoinCodeInfo,
    ResolveVersePathResponse,
    TeamMemberPrefs,
    OrganizationId,
    AccountId,
    TypedId,
    BuildProfileResult,
    ModuleVersionStatus,
    TeamId,
    JobPlatform,
    HotfixInfo,
    HotfixApplyRequest,
    HotfixUploadRequest,
    HotfixUpdateRequest,
    HotfixAssignmentDoc,
    StaticModuleDoc,
    ValidatePublishResult,
    VerseRuntimeErrorCrashGroup, ModerationJobTypes,
    WorkspaceDoc,
    CreateWorkspaceRequest,
    UpdateWorkspaceRequest,
} from "@app/types";

import config from "@www/config";

import { Hasher } from "js-sha256";

export type GenPackageResponse = {
    content: readonly ManifestEntry[],
    projectId: string,
}

type UploadProgress = {
    pctComplete: number;
}

type DSSAccessFileV1 = {
    readLink: string;
    writeLink: string;
    hash: string | null;
    lastModified: string | null;
    size: number;
    fileLocked: boolean;
};

type DSSAccessResponseV1 = {
    files: Record<string, DSSAccessFileV1>;
    folderThrottled: boolean;
    maxFileSizeBytes: number;
    maxFolderSizeBytes: number;
};

const DefaultHeaders = { "Content-Type": "application/json", "X-Epic-Requestor": "ContentService" };
const RequestorHeader = { "X-Epic-Requestor": "ContentService" };

interface ErrorPayload
{
    errorCode:string;
    errorMessage:string;
}

function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<{ success: true, status: number, response: T }|{ success: false, status: number, response: ErrorPayload }> {
    return fetch(input, init).then(async (rsp) => {
        if (rsp.ok) {
            if (rsp.status !== 204)
                return { success: true, status: rsp.status, response: await rsp.json() as T };
            else
                return { success: true, status: rsp.status, response: { } as T };
        }

        return { success: false, status: rsp.status, response: await rsp.json() || { errorCode: "http."+rsp.status, errorMessage: `http ${rsp.status}` } };
    });
}

function fetchJsonAndThrow<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
    return fetchJson<T>(input, init).then((resp) => {
        if (!resp.success)
            throw resp.response;
        return resp.response;
    });
}

export async function getAccountInfoById(accountId: string): Promise<AccountInfo> {
    // this is now just a wrapper for lookupName
    const result = await lookupName({ id: accountId, type: "account" });
    return { id: accountId, email: undefined, displayName: result.name };
}

// HOTFIX to allow users to join teams from team page. Longer-term solution will be covered here:
// https://jira.it.epicgames.com/browse/FORT-542679
export async function getAccountInfoByIdWithEmail(accountId: string): Promise<AccountInfo> {
    const method = "GET";
    const url = `${config.adminApiBaseUrl}/account/${encodeURIComponent(accountId)}/info`;
    const headers = { ...DefaultHeaders };

    return fetchJsonAndThrow<AccountInfo>(url, { method, headers });
}

// this is also recorded in session storage
const _namesCache = new Map<string,Promise<string>>();
export async function lookupName(obj: TypedId): Promise<TypedId&{name: string}> {
    // see if it's in the cache
    let namePromise = _namesCache.get(obj.id);
    if (namePromise === undefined) {
        namePromise = (async (): Promise<string> => {
            // check local storage
            const key = `id:${obj.id}.name`;
            const storage = sessionStorage;
            if (storage) {
                const cached = storage.getItem(key);
                if (cached !== null)
                    return cached;
            }

            // resolve name
            let name  = `${obj.type}:${obj.id}`;
            try {
                if (obj.type === "account") {
                    const method = "GET";
                    const url = `${config.adminApiBaseUrl}/account/${encodeURIComponent(obj.id)}/info`;
                    const headers = { ...DefaultHeaders };
                    const resp = await fetchJson<AccountInfo>(url, { method, headers });
                    if (resp.success)
                        name = resp.response.displayName;
                    else
                        name = "invalid-account";
                } else if (obj.type === "team") {
                    const resp = await getTeamById(obj.id);
                    if (resp)
                        name = resp.publicProps.name;
                    else
                        name = "invalid-team";
                } else if (obj.type === "project") {
                    const resp = await getProjectUserInfo(obj.id);
                    if (resp)
                        name = resp.title;
                    else
                        name = "invalid-project";
                } else {
                    throw `TODO: NameOf(${obj.type}:${obj.id})`;
                }

                // update local storage
                if (storage)
                    storage.setItem(key, name);
            } catch (err) {
                console.error(`error looking up name of ${obj.id}`, err);
            }
            return name;
        })();

        // whatever we get, populate the cache so we don't look it up again
        _namesCache.set(obj.id, namePromise);
    }

    // return obj form
    return {
        id: obj.id,
        type: obj.type,
        name: await namePromise,
    };
}

export async function resaveTable(tableName: string) : Promise<unknown>  {
    const url = `${config.adminApiBaseUrl}/resave/${encodeURIComponent(tableName)}`;

    const method = "POST";
    const response = await fetchJsonAndThrow<unknown>(url, { method });

    console.debug(`resaved ${tableName}s`, response);
    return response;
}

export async function getBuildCodesForProject(projectId: string, olderThan?: Date): Promise<PagedResults<PublishedLink,Date>> {
    let url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/buildcodes`;
    if (olderThan !== undefined)
        url += `?olderThan=${encodeURIComponent(olderThan.toISOString())}`;

    const method = "GET";
    const headers = { ...DefaultHeaders };
    const response = await fetchJsonAndThrow<PagedResults<PublishedLink,Date>>(url, { method, headers });
    if (response.next)
        response.next = moment(response.next).toDate();

    // prefetch (so all these requests are in parallel)
    for (const result of response.results)
        lookupName(result.publishedBy).catch();

    for (const result of response.results) {
        result.publishedBy = await lookupName(result.publishedBy) as AccountId;
        result.lastPublished = moment(result.lastPublished).toDate();
    }

    return response;
}

export async function getMyBuildCodesForProject(projectId: string, olderThan?: Date): Promise<PagedResults<PublishedLink,Date>> {
    let url = `${config.adminApiBaseUrl}/my-projects/build-codes/${encodeURIComponent(projectId)}`;
    if (olderThan !== undefined)
        url += `?olderThan=${encodeURIComponent(olderThan.toISOString())}`;

    const method = "GET";
    const headers = { ...DefaultHeaders };
    const response = await fetchJsonAndThrow<PagedResults<PublishedLink,Date>>(url, { method, headers });
    if (response.next)
        response.next = moment(response.next).toDate();

    // prefetch (so all these requests are in parallel)
    for (const result of response.results)
        lookupName(result.publishedBy).catch();

    for (const result of response.results) {
        result.publishedBy = await lookupName(result.publishedBy) as AccountId;
        result.lastPublished = moment(result.lastPublished).toDate();
    }
    return response;
}

export async function getProjectsByOwner(accountId: string, olderThan?: Date): Promise<PagedResults<ProjectSearchResultSlim,Date>> {
    let url = `${config.adminApiBaseUrl}/account/${encodeURIComponent(accountId)}/projects`;
    if (olderThan !== undefined)
        url += `?olderThan=${encodeURIComponent(olderThan.toISOString())}`;
    const method = "GET";
    const headers = { ...DefaultHeaders };

    const response = await fetchJsonAndThrow<PagedResults<ProjectSearchResultSlim,Date>>(url, { method, headers });
    if (response.next)
        response.next = moment(response.next).toDate();

    // prefetch (so all these requests are in parallel)
    for (const result of response.results)
        lookupName(result.info.owner).catch();

    for (const result of response.results) {
        result.info.owner = await lookupName(result.info.owner) as AccountId | TeamId;
        result.date = moment(result.date).toDate();
    }

    console.debug(`retrieved project results. ${response.results.length >= response.limit ? "(has more)" : "done."}`, response.results);
    return response;
}

export async function getStarredProjects(olderThan?: Date): Promise<PagedResults<ProjectSearchResultSlim,Date>> {
    let url = `${config.adminApiBaseUrl}/my-projects/slim`;
    if (olderThan !== undefined)
        url += `?olderThan=${encodeURIComponent(olderThan.toISOString())}`;

    const method = "GET";
    const headers = { ...DefaultHeaders };

    const response = await fetchJsonAndThrow<PagedResults<ProjectSearchResultSlim,Date>>(url, { method, headers });
    if (response.next)
        response.next = moment(response.next).toDate();

    // prefetch (so all these requests are in parallel)
    for (const result of response.results)
        lookupName(result.info.owner).catch();

    for (const result of response.results) {
        result.info.owner = await lookupName(result.info.owner) as AccountId | TeamId;
        result.date = moment(result.date).toDate();
    }

    console.debug(`retrieved project results. ${response.results.length >= response.limit ? "(has more)" : "done."}`, response.results);
    return response;
}

export async function addStar(projectId: string, is_new?: "new"): Promise<void> {
    const method = "PUT";
    let url = `${config.adminApiBaseUrl}/my-projects/${encodeURIComponent(projectId)}`;
    if (is_new)
        url += "?new=true";
    await fetchJsonAndThrow(url, { method });
}

export async function launchLinkCode(linkCode: string): Promise<"notified"|"queued"> {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/launch/link/${encodeURIComponent(linkCode)}`;
    const response = await fetchJsonAndThrow<{ status: "notified"|"queued" }>(url, { method });
    return response.status;
}

export async function unstageLinkCode(linkCode: string): Promise<boolean> {
    const method = "POST";
    const url = `${config.adminApiBaseUrl}/link/${encodeURIComponent(linkCode)}/unstage`;
    await fetchJsonAndThrow(url, { method });
    return true;
}

export async function restageLinkCode(linkCode: string): Promise<boolean> {
    const method = "POST";
    const url = `${config.adminApiBaseUrl}/link/${encodeURIComponent(linkCode)}/restage`;
    await fetchJsonAndThrow(url, { method });
    return true;
}

export async function getLaunchData(): Promise<unknown> {
    const method = "GET";
    const url = `${config.publicContentApiBaseUrl_v2}/launch-data`;
    const response = await fetchJsonAndThrow(url, { method });
    return response;
}

async function removeStarInternal(projectId: string, force: boolean): Promise<boolean> {
    const method = "DELETE";
    const url = `${config.adminApiBaseUrl}/my-projects/${encodeURIComponent(projectId)}?force=${force?"true":"false"}`;
    const response = await fetchJson(url, { method });
    if (!response.success) {
        if (response.response.errorCode.endsWith(".irreversible_operation"))
            return false;
        throw response.response;
    }
    return true;
}
export async function removeStar(projectId: string): Promise<void> {
    if (!await removeStarInternal(projectId, false)) {
        if (!confirm("You won't be able to re-star this project since you no longer have access. Is this ok?"))
            throw { errorCode: "cancelled", errorMessage: "Operation Cancelled" };
        if (!await removeStarInternal(projectId, true))
            throw new Error("Unexpected failure of force remove");
    }
}

export async function assignProjectAddress(projectId: string, vpath: string): Promise<{ versePath: string, url: string, primary: boolean }> {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/address/assign`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify({ versePath: vpath });
    const result = await fetchJsonAndThrow<{ versePath: string, url: string, primary: boolean }>(url, { method, headers, body });
    return result;
}

export async function getProjectAddresses(projectId: string): Promise<{ versePath: string, url: string, primary: boolean }[]> {
    const method = "GET";
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/addresses`;
    return fetchJsonAndThrow<{ versePath: string, url: string, primary: boolean }[]>(url, { method });
}

export async function purgeUnpublishedProjectAddresses(projectId: string, projectAddress: string): Promise<void> {
    const method = "DELETE";
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/addresses`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify({ address: projectAddress });

    await fetchJsonAndThrow<void>(url, { method, headers, body });
}

export async function resolveVersePath(vpath: string): Promise<ResolveVersePathResponse> {
    const method = "GET";
    if (vpath.startsWith("/"))
        vpath = `verse:${vpath}`;
    const url = `${config.publicContentApiBaseUrl_v4}/verse/${encodeURI(vpath)}`;
    return fetchJsonAndThrow<ResolveVersePathResponse>(url, { method });
}

export async function getVerseRuntimeErrorGroupsByProject(projectId: string, limit?: number,  olderThan?: Date, linkCode?: string, moduleId?: string, moduleVersion?: number): Promise<PagedResults<VerseRuntimeErrorCrashGroup, Date>>
{
    const query = new URLSearchParams();
    if (limit)
        query.set("limit", limit.toString());
    if (olderThan)
        query.set("olderThan", olderThan.toISOString());
    if (linkCode)
        query.set("linkCode", linkCode);
    if (moduleId)
        query.set("moduleId", moduleId);
    if (moduleVersion)
        query.set("moduleVersion", moduleVersion.toString());

    const headers = { ...DefaultHeaders };
    const method = "GET";
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/verse/runtime-errors/crash-groups?${query.toString()}`;
    const response = await fetchJsonAndThrow<PagedResults<VerseRuntimeErrorCrashGroup, Date>>(url, { method, headers });

    if (response.next)
        response.next = moment(response.next).toDate();

    return response;
}

export async function getProjectSnapshot(projectId: string): Promise<ProjectSnapshot> {
    const method = "GET";
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/snapshot`;
    const headers = { ...DefaultHeaders };
    return fetchJsonAndThrow<ProjectSnapshot>(url, { method, headers });
}

export async function setProjectSnapshot(projectId: string, content: ResolvedContent, palette: VersionedLinkCode[], mapPath: string): Promise<ProjectSnapshot> {
    const method = "PUT";
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/snapshot`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify({ content, palette, mapPath });
    return fetchJsonAndThrow<ProjectSnapshot>(url, { method, headers, body });
}

let _webClientConfig: Promise<WebClientConfig>;
export function getWebClientConfig(): Promise<WebClientConfig> {
    if (!_webClientConfig) {
        const method = "GET";
        const url = `${config.adminApiBaseUrl}/web-client-config`;
        const headers =  { ...DefaultHeaders };

        _webClientConfig = fetchJsonAndThrow<WebClientConfig>(url, { method, headers });
    }

    return _webClientConfig;
}

export async function getStagedFile({ moduleId, version }: { moduleId: string, version: number }, fileName: string): Promise<Response> {
    const method = "GET";
    const url = `${config.publicContentApiBaseUrl_v2}/module/${encodeURIComponent(moduleId)}/version/${version}/staged-files/${encodeURI(fileName)}`;
    const file = await fetch(url, { method, headers: RequestorHeader }).then(async (rsp) => {
        if (!rsp.ok)
            throw new Error(`http ${rsp.status} from ${url}`);
        return rsp;
    });
    return file;
}

export async function getZipFile({ moduleId, version }: { moduleId: string, version: number }, jobPlatform : JobPlatform): Promise<Response> {
    const method = "GET";
    const url = `${config.adminApiBaseUrl}/module/${encodeURIComponent(moduleId)}/version/${version}/zip-file`;

    // ignore first 404 and try again
    for (let i = 0; i < 2; i++) {
        const file = await fetch(url, { method, headers: RequestorHeader }).then(async (rsp) => {
            if (!rsp.ok){
                if (rsp.status === 404) {
                    await triggerModuleFileZipJob(moduleId, version, jobPlatform);
                }
                else {
                    let errorMessage = `http ${rsp.status} from ${url}`
                    throw new Error(errorMessage);
                }
            }
            return rsp;
        });
        if (file.ok) {
            return file;
        }
    }

    throw new Error(`http 404 from ${url}`);
}

export async function setCookers(request: { rvn: number, selectors: Omit<CookVersionSelector, "min_version" | "max_version">[] }): Promise<void> {
    const method = "PUT";
    const url = `${config.adminApiBaseUrl}/cookers`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify(request);

    await fetchJsonAndThrow<void>(url, { method, headers, body });
    console.debug("cooker config set.", request);
}

export async function getCookers(): Promise<CookVersionSelectorGroup> {
    const method = "GET";
    const url = `${config.adminApiBaseUrl}/cookers`;
    const headers = { ...DefaultHeaders };

    const result = await fetchJsonAndThrow<CookVersionSelectorGroup>(url, { method, headers });
    result.date = moment(result.date).toDate();
    for (const entry of result.selectors)
        entry.dateModified = moment(entry.dateModified).toDate();

    console.debug("retrieved current cooker config", result);
    return result;
}

export async function getCookerHistory(): Promise<CookVersionSelectorGroup[]> {
    const method = "GET";
    const url = `${config.adminApiBaseUrl}/cookers/history`;
    const headers = { ...DefaultHeaders };

    const result = await fetchJsonAndThrow<CookVersionSelectorGroup[]>(url, { method, headers });

    for (const history of result)
        history.date = moment(history.date).toDate();

    console.debug("retrieved current cooker config", result);
    return result;
}

export async function promoteCooker(selector: { buildRange: string, cacheKey: string, cookerImageTag: string, meta?: Record<string, unknown> }): Promise<{ new: CookVersionSelector[], old: CookVersionSelector[] }> {
    const method = "POST";
    const url = `${config.adminApiBaseUrl}/cookers/promote`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify(selector);

    const result = await fetchJsonAndThrow<{ new: CookVersionSelector[], old: CookVersionSelector[] }>(url, { method, headers, body });

    console.debug("cooker promotion compelte", result);
    return result;
}

export async function activateSelector(major: number|string, minor: number, patch: number, activationKeys: string[]) : Promise<void>  {
    const method = "POST";
    const url = `${config.adminApiBaseUrl}/cookers/activate?major=${major}&minor=${minor}&patch=${patch}`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify({ envs: activationKeys });
    await fetchJsonAndThrow<void>(url, {method, headers, body});
    console.debug("activation complete");
}

export async function deactivateSelectors(activationKeys: string[]) : Promise<void>  {
    const method = "DELETE";
    const url = `${config.adminApiBaseUrl}/cookers/activate`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify({ envs: activationKeys });
    await fetchJsonAndThrow<void>(url, {method, headers, body});
    console.debug("deactivation complete");
}

export async function setCookSelectorRestriction(major: number, minor: number) : Promise<void>  {
    const method = "POST";
    const url = `${config.adminApiBaseUrl}/cookers/restrict?major=${major}&minor=${minor}`;
    const headers = { ...DefaultHeaders };
    await fetchJsonAndThrow<void>(url, {method, headers});
    console.debug("restriction applied");
}

export async function clearCookselectorRestriction() : Promise<void>  {
    const method = "DELETE";
    const url = `${config.adminApiBaseUrl}/cookers/restrict`;
    const headers = { ...DefaultHeaders };
    await fetchJsonAndThrow(url, {method, headers});
    console.debug("restriction cleared");
}

export async function purgeLiveLink(projectId: string) : Promise<void>  {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/purge-livelink`;
    const headers = { ...DefaultHeaders };

    await fetchJsonAndThrow<void>(url, { method, headers });
}

export async function purgeModuleArtifacts(moduleId: string) : Promise<void>  {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/module/${encodeURIComponent(moduleId)}/purge-artifacts`;
    const headers = { ...DefaultHeaders };

    await fetchJsonAndThrow<void>(url, { method, headers });
}

export async function purgeModuleArtifactsForVersion(moduleId: string, moduleVersion: number) : Promise<void>  {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/module/${encodeURIComponent(moduleId)}/version/${encodeURIComponent(moduleVersion)}/purge-artifacts`;
    const headers = { ...DefaultHeaders };

    await fetchJsonAndThrow<void>(url, { method, headers });
}

export async function purgeModuleCache(moduleId: string) : Promise<void>  {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/module/${encodeURIComponent(moduleId)}/purge-cache`;
    const headers = { ...DefaultHeaders };

    await fetchJsonAndThrow<void>(url, { method, headers });
}

export async function purgeModule(moduleId: string) : Promise<void>  {
    const method = "POST";
    const url = `${config.adminApiBaseUrl}/module/${encodeURIComponent(moduleId)}/purge-all`;
    const headers = { ...DefaultHeaders };

    await fetchJsonAndThrow<void>(url, { method, headers });
}

function encodeVersionParams(buildVersion: BuildVersion): string {
    let params = `major=${encodeURIComponent(buildVersion.major)}&minor=${encodeURIComponent(buildVersion.minor)}`;
    if (!isNaN(buildVersion.patch))
        params += `&patch=${encodeURIComponent(buildVersion.patch)}`;
    return params;
}

function encodeCommandParams(
    overrides?: string,
    options?: string,
    cookerVersion?: string,
    buildVersion?: string) : string[] {
    const params: string[] = [];
    if(overrides !== undefined && overrides.length != 0)
        params.push(`UAT_OVERRIDES=${encodeURIComponent(overrides)}`);
    if(options !== undefined && options.length != 0)
        params.push(`COMMANDLET_OPTIONS=${encodeURIComponent(options)}`);
    if(cookerVersion !== undefined && cookerVersion.length != 0)
        params.push(`cookerVersion=${encodeURIComponent(cookerVersion)}`);
    if(buildVersion !== undefined && buildVersion.length != 0)
        params.push(`buildVersion=${encodeURIComponent(buildVersion)}`);
    return params;
}

export async function getArtifactCookResult(artifactId: string, buildVersion: BuildVersion, jobPlatform: JobPlatform, noWait?:"no-wait", cmdOverrides?: string, cmdOptions?: string, hotfixId?:string, debugEnvOverrides?: string): Promise<ArtifactCookResult> {
    let url = `${config.publicContentApiBaseUrl_v2}/artifact/${encodeURIComponent(artifactId)}/cooked-content?${encodeVersionParams(buildVersion)}&jobPlatform=${jobPlatform}`;

    if (noWait)
        url += "&wait=false";

    const cmdParams = encodeCommandParams(cmdOverrides, cmdOptions);
    for(let i = 0; i < cmdParams.length; ++i)
        url += `&${cmdParams[i]}`;

    if (hotfixId) {
        url += `&hotfixId=${hotfixId}`;
    }

    if (debugEnvOverrides) {
        url += `&debugEnvOverrides=${debugEnvOverrides}`;
    }

    return fetch(url, { method: "GET", headers: RequestorHeader }).then(async (rsp) => {
        if (rsp.status === 429 || rsp.status === 200) {
            const result : ArtifactCookResult = await rsp.json();
            result.start = moment(result.start).toDate();
            if (result.status !== "pending")
                result.end = moment(result.end).toDate();
            console.debug(`retrieved binaries for artifact: ${artifactId} at v${buildVersion.major}.${buildVersion.minor}.${buildVersion.patch}`, result);
            return result;
        }
        const error = await rsp.json() || { errorCode: "http."+rsp.status, errorMessage: `http ${rsp.status}` };
        throw { errorCode: error.errorCode || "unknown", errorMessage: error.errorMessage || await rsp.text() || rsp.statusText };
    });
}

export async function getRevalidationResult(moduleId: string, moduleVersion : number, buildVersion: BuildVersion, jobPlatform: JobPlatform, hotfixId?: string, performResave?: boolean, performCook?: boolean, suppressFixableErrors?: boolean): Promise<ValidationResult> {
    let url = `${config.publicContentApiBaseUrl_v2}/module/${encodeURIComponent(moduleId)}/version/${moduleVersion}/revalidate?${encodeVersionParams(buildVersion)}&jobPlatform=${jobPlatform}`;
    url += `&performResave=${performResave ?? false}`;
    url += `&performCook=${performCook ?? false}`;
    url += `&suppressFixableErrors=${suppressFixableErrors ?? false}`;

    if (hotfixId) {
        url += `&hotfixId=${hotfixId}`;
    }

    return fetch(url, { method: "POST", headers: RequestorHeader }).then(async (rsp) => {
        if (rsp.status === 429 || rsp.status === 200) {
            const result : ValidationResult = await rsp.json();
            result.start = moment(result.start).toDate();
            if (result.status !== "pending")
                result.end = moment(result.end).toDate();
            console.debug(`ran validation for: ${moduleId}v${moduleVersion} using ${buildVersion}`, result);
            return result;
        }
        const error = await rsp.json() || { errorCode: "http."+rsp.status, errorMessage: `http ${rsp.status}` };
        throw { errorCode: error.errorCode || "unknown", errorMessage: error.errorMessage || await rsp.text() || rsp.statusText };
    });
}

export async function deleteProject(projectId: string): Promise<void> {
    const method = "DELETE";
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}`;
    await fetchJsonAndThrow(url, { method });
}

async function fixupProject(project: ProjectDoc) : Promise<void>  {
    project.owner = await lookupName(project.owner) as  AccountId | TeamId;
    if (project.liveLink)
        project.liveLink.publishedBy = await lookupName(project.liveLink.publishedBy) as AccountId;
    if (project.archived)
        project.archived = moment(project.archived).toDate();
    project.created = moment(project.created).toDate();
}

export async function setProjectArchiveStatus(projectId: string, is_archived: boolean): Promise<ProjectDoc> {
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/archive`;
    const method = is_archived ? "POST" : "DELETE";

    const result = await fetchJsonAndThrow<ProjectDoc>(url, { method });
    await fixupProject(result);

    console.debug(`retrieved project document: ${projectId}`, result);
    return { ... result, created: moment(result.created).toDate() };
}

export async function getProjectDocument(projectId: string): Promise<ProjectDoc> {
    const method = "GET";
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}`;
    const headers = { ...DefaultHeaders };

    const result = await fetchJsonAndThrow<ProjectDoc>(url, { method, headers });
    await fixupProject(result);

    console.debug(`retrieved project document: ${projectId}`, result);
    return { ... result, created: moment(result.created).toDate() };
}

export async function getProjectUserInfo(projectId: string): Promise<ProjectUserInfo> {
    const method = "GET";
    const url = `${config.adminApiBaseUrl}/my-projects/user-info/${encodeURIComponent(projectId)}`;
    const headers = { ...DefaultHeaders };

    const result = await fetchJsonAndThrow<ProjectUserInfo>(url, { method, headers });

    console.debug(`retrieved project info: ${projectId}`, result);
    return result;
}

export async function postNewProjectDocument(projectDoc: CreateProjectRequest) : Promise<ProjectDoc>  {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/project`;
    const headers = { ...DefaultHeaders };
    const docCopy = { ...projectDoc, meta: { ...projectDoc.meta } };
    const body = JSON.stringify(docCopy);

    const result = await fetchJsonAndThrow<ProjectDoc>(url, { method, headers, body });
    await fixupProject(result);

    console.debug(`created new project: ${result.projectId}`, result);
    return result;
}

export async function getModuleDocument(moduleId: string): Promise<ModuleDoc> {
    const method = "GET";
    const url = `${config.publicContentApiBaseUrl_v2}/module/${encodeURIComponent(moduleId)}`;
    const headers = { ...DefaultHeaders };

    const result = await fetchJsonAndThrow<ModuleDoc>(url, { method, headers });
    result.author = await lookupName(result.author) as AccountId;

    console.debug(`retrieved module document: ${moduleId}`, result);
    return { ... result, created: moment(result.created).toDate(), updated: moment(result.updated).toDate() };
}

export async function postNewModuleDocument(projectId: string, moduleDoc: CreateModuleRequest) : Promise<ModuleDoc>  {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/create/module`;
    const headers = { ...DefaultHeaders };
    const docCopy = { ...moduleDoc, meta: { ...moduleDoc.meta } };
    const body = JSON.stringify(docCopy);

    const result = await fetchJsonAndThrow<ModuleDoc>(url, { method, headers, body });
    result.author = await lookupName(result.author) as AccountId;

    console.debug(`created new module: ${result.moduleId} in project: ${projectId}`, result);
    return result;
}

export async function findModulesInProject(projectId: string, olderThan?: Date): Promise<PagedResults<ModuleSearchResult,Date>> {
    let url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/modules`;
    if (olderThan !== undefined)
        url += `?olderThan=${encodeURIComponent(olderThan.toISOString())}`;

    const method = "GET";
    const headers = { ...DefaultHeaders };

    const response = await fetchJsonAndThrow<PagedResults<ModuleSearchResult,Date>>(url, { method, headers });
    if (response.next)
        response.next = moment(response.next).toDate();

    // prefetch (so all these requests are in parallel)
    for (const result of response.results)
        lookupName(result.author).catch();

    for (const result of response.results) {
        result.author = await lookupName(result.author) as AccountId;
        result.created = moment(result.created).toDate();
        result.updated = moment(result.updated).toDate();
    }

    console.debug(`retrieved module results. ${response.results.length >= response.limit ? "(has more)" : "done."}`, response.results);
    return response;
}

export async function getModuleVersionStatus(moduleId: string, version: number): Promise<ModuleVersionStatus> {
    const method = "GET";
    const url = `${config.publicContentApiBaseUrl_v2}/module/${encodeURIComponent(moduleId)}/version/${version}/status`;
    const headers = { ...DefaultHeaders };

    const result = await fetchJsonAndThrow<ModuleVersionStatus>(url, { method, headers });

    console.debug(`retrieved version status: ${moduleId}@${version}`, result);
    return result;
}

export async function getModuleVersion(moduleId: string, version: number): Promise<ModuleVersionDocWithArtifacts> {
    const method = "GET";
    const url = `${config.publicContentApiBaseUrl_v2}/module/${encodeURIComponent(moduleId)}/version/${version}`;
    const headers = { ...DefaultHeaders };

    const result = await fetchJsonAndThrow<ModuleVersionDocWithArtifacts>(url, { method, headers });
    result.author = await lookupName(result.author) as AccountId;

    result.stagedFiles.files.sort();

    console.debug(`retrieved version document: ${result.moduleId}@${result.version}`, result);
    return { ...result, created: moment(result.created).toDate() };
}

export async function findModuleVersionByChecksum(moduleId: string, checksum: string) : Promise<ModuleVersionDocWithArtifacts> {
    const method = "GET";
    const url = `${config.publicContentApiBaseUrl_v2}/module/${encodeURIComponent(moduleId)}/checksum/${encodeURIComponent(checksum)}`;
    const headers = { ...DefaultHeaders };

    const result = await fetchJsonAndThrow<ModuleVersionDocWithArtifacts>(url, { method, headers });
    result.author = await lookupName(result.author) as AccountId;

    console.debug(`retrieved version document: ${result.moduleId}@${result.version}`, result);
    return { ...result, created: moment(result.created).toDate() };
}


export async function triggerModeration(
    moduleId: string,
    version: number,
    jobPlatform: JobPlatform,
    cookerVersion?: string,
    cmdOverrides?: string,
    cmdOptions?: string,
    buildVersion?: string,
    skipDeduplication?: boolean,
    disableDefaultCommandletOptions?: boolean,
    fallbackToStableVersion?: boolean
) : Promise<void> {
    await triggerModerationInternal(
        'iterate',
        moduleId,
        version,
        jobPlatform,
        cookerVersion,
        cmdOverrides,
        cmdOptions,
        buildVersion,
        skipDeduplication,
        disableDefaultCommandletOptions,
        fallbackToStableVersion
    );
}

export async function triggerPublishModeration(
    moduleId: string,
    version: number,
    jobPlatform: JobPlatform,
    cookerVersion?: string,
    cmdOverrides?: string,
    cmdOptions?: string,
    buildVersion?: string,
    skipDeduplication?: boolean,
    disableDefaultCommandletOptions?: boolean,
    fallbackToStableVersion?: boolean
) : Promise<void> {
    await triggerModerationInternal(
        'publish',
        moduleId,
        version,
        jobPlatform,
        cookerVersion,
        cmdOverrides,
        cmdOptions,
        buildVersion,
        skipDeduplication,
        disableDefaultCommandletOptions,
        fallbackToStableVersion
    );
}

async function triggerModerationInternal(
    jobType: ModerationJobTypes,
    moduleId: string,
    version: number,
    jobPlatform: JobPlatform,
    cookerVersion?: string,
    cmdOverrides?: string,
    cmdOptions?: string,
    buildVersion?: string,
    skipDeduplication?: boolean,
    disableDefaultCommandletOptions?: boolean,
    fallbackToStableVersion?: boolean
    ) : Promise<void> {
    const cmdParams = encodeCommandParams(cmdOverrides, cmdOptions, cookerVersion, buildVersion);
    let queryStr = `?jobPlatform=${jobPlatform}`;
    if(cmdParams.length > 0) {
        for(let i = 0; i < cmdParams.length; ++i)
            queryStr += `&${cmdParams[i]}`;
    }

    if(skipDeduplication != undefined) {
        queryStr += `&skipDeduplication=${skipDeduplication}`;
    }

    if(disableDefaultCommandletOptions != undefined) {
        queryStr += `&disableDefaultCommandletOptions=${disableDefaultCommandletOptions}`;
    }

    if(fallbackToStableVersion != undefined) {
        queryStr += `&fallbackToStableVersion=${fallbackToStableVersion}`;
    }

    const method = "POST";
    const url = `${config.adminApiBaseUrl}/module/${encodeURIComponent(moduleId)}/version/${version}/gen-moderation/${jobType}${queryStr}`;
    const headers = { ...DefaultHeaders };
    const response = await fetchJsonAndThrow<{
        ticketId: string
    }>(url, {method, headers});
    console.log(`triggered ${jobType} moderation with ticketId: ${response.ticketId}`);
}

export async function triggerValidatePublish(projectId: string, baseCode: { code: string, version?: number }, timeout = 30): Promise<ValidatePublishResult>
{
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/publish/validate?timeout=${timeout}`;

    const headers = { ...DefaultHeaders };
    const body = JSON.stringify({ baseCode });

    const startTime = performance.now();
    console.debug(`starting validate publish for base code: ${baseCode.code}v${baseCode.version}`);
    let result: ValidatePublishResult = { status: "pending" };
    while (result.status === "pending")
    {
        console.debug(`...polling with timeout: ${timeout}`);
        result = await fetchJsonAndThrow<ValidatePublishResult>(url, { method, headers, body });
    }

    const endTime = performance.now();
    console.debug(`finished validate publish for base code: ${baseCode.code}v${baseCode.version} (runtime: ${endTime - startTime}ms})`, result);
    return result;
}

export async function promoteBuildCode(projectId: string, buildCode: { code: string, version?: number }, commitMessage: string, playtestGroupId: string) : Promise<PublishedLink | undefined>  {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/publish/playtest/${encodeURIComponent(playtestGroupId)}`;

    const headers = { ...DefaultHeaders };
    const body = JSON.stringify({
        baseCode: buildCode,
        commitMessage,
        activate: true,
        meta: {}
    });

    const result = await fetchJsonAndThrow<PublishedLink>(url, { method, headers, body });
    result.publishedBy = await lookupName(result.publishedBy) as AccountId;
    console.debug(`published PLAYTEST link code ${result.linkCode}v${result.linkVersion}`, body, result);
    return { ...result, lastPublished: moment(result.lastPublished).toDate() };
}

export async function generateModerationBuildCode(projectId: string, snapshotId: string): Promise<PublishedLink> {
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/generate/buildcode/for-moderation/${encodeURIComponent(snapshotId)}`;
    const result = await fetchJsonAndThrow<PublishedLink>(url, { method: "POST" });
    result.publishedBy = await lookupName(result.publishedBy) as AccountId;
    return { ...result, lastPublished: moment(result.lastPublished).toDate() };
}

export async function generateBuildCode(projectId: string, request: GenerateBuildcodeRequest): Promise<PublishedLink> {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/generate/buildcode`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify(request);

    const result = await fetchJsonAndThrow<PublishedLink>(url, { method, headers, body });
    result.publishedBy = await lookupName(result.publishedBy) as AccountId;
    console.debug(`published playtest link code ${result.linkCode}v${result.linkVersion}`, request, result);
    return { ...result, lastPublished: moment(result.lastPublished).toDate() };
}

// create a new module version job and then return the ticket id
export async function createNewModuleVersionJob(moduleId: string, versionInfo: UploadModuleVersionRequest, sourceVer: BuildVersion, jobPlatform: JobPlatform): Promise<{ moduleId: string, ticketId: string }> {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/module/${encodeURIComponent(moduleId)}/version/async?jobPlatform=${jobPlatform}&major=${sourceVer.major}&minor=${sourceVer.minor}&patch=${sourceVer.patch}`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify(versionInfo);
    const result = await fetchJsonAndThrow<{ moduleId: string, ticketId: string }>(url, { method, headers, body });
    return result;
}

export async function pollNewModuleVersionJob(moduleId: string, ticketId: string, timeout = 10): Promise<{ ready: false } | { ready: true, response: ModuleVersionDocWithArtifacts }> {
    const method = "GET";
    const url = `${config.publicContentApiBaseUrl_v2}/module/${encodeURIComponent(moduleId)}/poll/${encodeURIComponent(ticketId)}?timeout=${timeout}`;

    const rsp = await fetchJson<ModuleVersionDocWithArtifacts>(url, { method });
    if (!rsp.success)
        throw rsp.response;

    if (rsp.status === 204)
        return { ready: false };

    const response = rsp.response;
    response.author = await lookupName(response.author) as AccountId;
    response.created = moment(response.created).toDate();
    console.debug(`created new version document: ${response.moduleId}@${response.version}`, response);
    return { ready: true, response };
}

export async function uploadProfileResult(buildCode: string, profile: BuildProfileResult) : Promise<void> {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/add-profile/link/${encodeURIComponent(buildCode)}`;

    const headers = { ...DefaultHeaders };
    const body = JSON.stringify(profile);

    await fetchJsonAndThrow(url, { method, headers, body });
}


export async function setModuleName(moduleId: string, newName: string) : Promise<void> {
    const method = "PUT";
    const url = `${config.publicContentApiBaseUrl_v2}/module/${encodeURIComponent(moduleId)}/name`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify({ moduleName: newName });

    await fetchJsonAndThrow(url, { method, headers, body });

    console.debug(`created updated module name for ${moduleId} to ${newName}`);
    return;
}

export async function putModuleLabel(moduleId: string, label: string, version: number) : Promise<void> {
    const method = "PUT";
    const url = `${config.publicContentApiBaseUrl_v2}/module/${encodeURIComponent(moduleId)}/labels/${encodeURIComponent(label.toLowerCase())}`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify({ version });

    await fetchJsonAndThrow(url, { method, headers, body });

    console.debug(`created new label assignment: '${label}' => ${version} (${moduleId})`);
    return;
}

export async function deleteModuleLabel(moduleId: string, label: string) : Promise<void> {
    const method = "DELETE";
    const url = `${config.publicContentApiBaseUrl_v2}/module/${encodeURIComponent(moduleId)}/labels/${encodeURIComponent(label.toLowerCase())}`;
    const headers = { ...DefaultHeaders };

    await fetchJsonAndThrow(url, { method, headers });

    console.debug(`removed label: '${label}' (${moduleId})`);
    return;
}

export async function setMetadata(docType: "module"|"project", docId: string, meta: Record<string, unknown>, star?: boolean): Promise<Record<string, unknown>> {
    const method = "PUT";
    const url = `${config.publicContentApiBaseUrl_v2}/${encodeURIComponent(docType)}/${encodeURIComponent(docId)}/meta?star=${star || "false"}`;
    const headers = { ...DefaultHeaders };

    const body = JSON.stringify(meta);
    const result = await fetchJsonAndThrow<Record<string, unknown>>(url, { method, headers, body });

    console.debug(`set metadata: ${docId}`, result);
    return result;
}

export async function setSysMeta(docType: "team"|"project", docId: string, meta: Record<string, unknown>): Promise<Record<string, unknown>> {
    const method = "PUT";
    const url = `${config.publicContentApiBaseUrl_v2}/${encodeURIComponent(docType)}/${encodeURIComponent(docId)}/meta/sys`;
    const headers = { ...DefaultHeaders };

    const body = JSON.stringify(meta);
    const result = await fetchJsonAndThrow<Record<string, unknown>>(url, { method, headers, body });

    console.debug(`set metadata: ${docId}`, result);
    return result;
}

interface LinkContentTree
{
    rootProjectId: string,
    projects: Map<string,{
        name: string,
        modules: Map<string,{
            pinnedVersion?: number,
            resolvedVersion?: number,
        }>,
    }>,
}

export async function inspectLink(link: string): Promise<LinkContentTree> {
    // get all pinned packages
    const pinnedPackage = await genPackageFromLink(link, false);
    const tree : LinkContentTree = {
        rootProjectId: pinnedPackage.projectId,
        projects: new Map(),
    };
    for (const content of pinnedPackage.content) {
        // get the project record
        let proj = tree.projects.get(content.projectId);
        if (proj === undefined) {
            // create if needed
            proj = {
                name: (await lookupName({ type: "project", id: content.projectId })).name,
                modules: new Map(),
            };
            tree.projects.set(content.projectId, proj);
        }

        // set the pinned version
        proj.modules.set(content.moduleId, { pinnedVersion: content.version });
    }

    // get all upgraded packages
    const upgradedPackage = await genPackageFromLink(link, true);
    for (const content of upgradedPackage.content) {
        // get the project record
        let proj = tree.projects.get(content.projectId);
        if (proj === undefined) {
            // create if needed
            proj = {
                name: (await lookupName({ type: "project", id: content.projectId })).name,
                modules: new Map(),
            };
            tree.projects.set(content.projectId, proj);
        }

        // get the module record
        let module = proj.modules.get(content.moduleId);
        if (module === undefined) {
            module = { };
            proj.modules.set(content.moduleId, module);
        }
        module.resolvedVersion = content.version;
    }

    // log
    console.log(`LINK INSPECTION REPORT for ${link}`);
    for (const [,proj] of tree.projects) {
        let hasPinned = false;
        let hasResolved = false;
        for (const mod of proj.modules.values()) {
            if (mod.pinnedVersion)
                hasPinned = true;

            if (mod.resolvedVersion)
                hasResolved = true;
        }

        if (hasPinned && hasResolved) {
            console.log(`Project: ${proj.name}`);
            for (const [moduleId,mod] of proj.modules) {
                if (mod.pinnedVersion && mod.resolvedVersion) {
                    if (mod.pinnedVersion === mod.resolvedVersion)
                        console.log(`   Module ${moduleId} v${mod.pinnedVersion}`);
                    else
                        console.log(`   Module ${moduleId} upgraded from v${mod.pinnedVersion} to v${mod.resolvedVersion}`);
                } else if (mod.pinnedVersion)
                    console.log(`   Module ${moduleId} v${mod.pinnedVersion} (REMOVED)`);
                else if (mod.resolvedVersion)
                    console.log(`   Module ${moduleId} v${mod.resolvedVersion} (ADDED)`);
            }
        } else if (!hasResolved) {
            console.log(`Project: ${proj.name} (REMOVED)`);
            for (const [moduleId,mod] of proj.modules)
                console.log(`   Module ${moduleId} v${mod.pinnedVersion} (REMOVED)`);
        } else if (!hasPinned) {
            console.log(`Project: ${proj.name} (ADDED)`);
            for (const [moduleId,mod] of proj.modules)
                console.log(`   Module ${moduleId} v${mod.resolvedVersion} (ADDED)`);
        }
    }
    return tree;
}

export async function genPackageFromLink(link: string, continuous?: boolean): Promise<GenPackageResponse> {
    const method = "GET";
    let url = `${config.publicContentApiBaseUrl_v2}/gen-package/link/${encodeURIComponent(link)}?`;
    if (continuous !== undefined)
        url += `continuous=${continuous}&`;
    const result = await fetchJsonAndThrow<GenPackageResponse>(url, { method });
    return result;
}

export async function genPackage(root: ModuleDependency, buildVersion?: BuildVersion, projectId?: string, resolutions?: Record<string,number>): Promise<GenPackageResponse> {

    const method = "POST";
    let url = `${config.publicContentApiBaseUrl_v2}/gen-package`;

    if(buildVersion) {
        url += `?major=${buildVersion.major}&minor=${buildVersion.minor}&patch=${buildVersion.patch}`;
    }

    const headers = { ...DefaultHeaders };
    const request : GenPackageRequest = {
        root,
        projectId,
        resolutions,
    };
    const body = JSON.stringify(request);

    const result = await fetchJsonAndThrow<GenPackageResponse>(url, { method, headers, body });

    console.debug(`generated package for: ${root.moduleId}@${root.version}`, result);
    return result;
}

export async function uploadScratchFile(accessToken: string, accountId: string, file: File, onProgress: (e: UploadProgress) => void) : Promise<string> {
    // we need current web-client-configuration.
    const wcc = await getWebClientConfig();

    // compute a checksum of the file
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasher : Hasher = (window as any).sha256.create();
    await file.stream().pipeTo(new WritableStream({
        write (str) : void {
            hasher.update(str);
        }
    }));
    const checksum = hasher.hex();

    // [GET] ask for a pre-signed url to which we can put this file.
    const slug = `${wcc.dssApp}/scratch/${accountId}/${encodeURIComponent(checksum)}`;
    const access = await fetchJsonAndThrow<DSSAccessResponseV1>(`${wcc.dssService}${wcc.dssAccessPath}/${slug}`, {
        method: "GET",
        headers: { ...DefaultHeaders, Authorization: `bearer ${accessToken}` },
    });

    // TODO: replace JQUERY with native FETCH.
    // prepare jquery args for s3 put operation.
    const method = "PUT";
    const data = file;
    const cache = false;
    const processData =  false;
    const contentType = "binary/octet-stream";

    // we need to capture our own xhr object so the caller can monitor upload progress.
    const xhr = () : XMLHttpRequest => {
        const req = new window.XMLHttpRequest();
        req.upload.addEventListener("progress", (progress) => {
            let pctComplete = 0;
            if (progress.lengthComputable) {
                pctComplete = Math.max(Math.min((progress.loaded / progress.total) * 100, 100), 0);
            }

            onProgress({ pctComplete });
        }, false);
        return req;
    };

    const target = access.files[decodeURIComponent(slug)];
    if (!target || !target.writeLink)
        throw new Error("failed to obtain writeLink.");

    // write the file to the pre-signed url.
    await $.ajax(target.writeLink, {
        xhr,
        data,
        cache,
        method,
        contentType,
        processData,
    });

    return target.readLink;
}

export async function getInventory(projectId: string, playerId: string): Promise<GetInventorySetResponse> {
    const method = "GET";
    const url = `${config.publicPersistenceApiUrl}/project/${projectId}/player/${playerId}/inventory`;
    const headers = { ...DefaultHeaders };

    return fetchJsonAndThrow<GetInventorySetResponse>(url, { method, headers });
}

export async function replaceInventory(projectId: string, playerId: string, type: string, inventory: Inventory): Promise<void> {
    const method = "PUT";
    const url = `${config.publicPersistenceApiUrl}/project/${projectId}/player/${playerId}/inventory/${encodeURIComponent(type)}`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify(inventory);

    return fetchJsonAndThrow<void>(url, { method, headers, body });
}

export async function updateInventory(projectId: string, playerId: string, type: string, baseVersion: string, changes: InventoryEdit): Promise<string> {
    const method = "POST";
    const url = `${config.publicPersistenceApiUrl}/project/${projectId}/player/${playerId}/inventory/${encodeURIComponent(type)}/edit?base=${encodeURIComponent(baseVersion)}`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify(changes);

    const result = await fetchJsonAndThrow<{ newVersion: string }>(url, { method, headers, body });
    return result.newVersion;
}

export async function deleteInventory(projectId: string, playerId: string, type: string): Promise<void> {
    const method = "DELETE";
    const url = `${config.publicPersistenceApiUrl}/project/${projectId}/player/${playerId}/inventory/${encodeURIComponent(type)}`;
    const headers = { ...DefaultHeaders };

    return fetchJsonAndThrow<void>(url, { method, headers });
}

export async function copyLiveInventoryToPlaytest(projectId: string, playerId: string) : Promise<void> {
    const method = "POST";
    const url = `${config.publicPersistenceApiUrl}/project/${projectId}/player/${playerId}/copy-to/playtest`;
    const headers = { ...DefaultHeaders };

    return fetchJsonAndThrow<void>(url, { method, headers });
}

export async function getIslandCodeInfo(linkCode: string): Promise<IslandCodeInfo> {
    const method = "GET";
    const url = `${config.adminApiBaseUrl}/link/${encodeURIComponent(linkCode)}`;
    const headers = { ...DefaultHeaders };

    const resp = await fetchJsonAndThrow<IslandCodeInfo>(url, { method, headers });
    return resp;
}

export async function getPlaytestCodes(projectId: string): Promise<{ group: { id: string, name: string }, link?: PublishedLink }[]> {
    const method = "GET";
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/playtestcodes`;
    const headers = { ...DefaultHeaders };

    const resp = await fetchJsonAndThrow<{ group: { id: string, name: string }, link?: PublishedLink }[]>(url, { method, headers });

    // prefetch (so all these requests are in parallel)
    for (const ent of resp) {
        if (ent.link)
            lookupName(ent.link.publishedBy).catch();
    }

    for (const ent of resp) {
        if (ent.link)
            ent.link.publishedBy = await lookupName(ent.link.publishedBy) as AccountId;
    }
    return resp;
}

///// MY TEAMS

// list all teams (paged) which the current user is a member of
export async function getMyTeams(olderThan?: Date): Promise<PagedResults<TeamMembership&{teamName: string},Date>> {
    const method = "GET";
    let url = `${config.adminApiBaseUrl}/my-teams`;
    if (olderThan !== undefined)
        url += `?olderThan=${encodeURIComponent(olderThan.toISOString())}`;
    const result = await fetchJsonAndThrow<PagedResults<TeamMembership&{teamName: string},Date>>(url, { method });
    if (result.next)
        result.next = moment(result.next).toDate();

    // prefetch (so all these requests are in parallel)
    for (const membership of result.results) {
        if (membership.name === membership.accountId)
            lookupName({ id: membership.accountId, type: "account" });
        lookupName({ id: membership.teamId, type: "team" }).catch();
    }

    for (const membership of result.results) {
        if (membership.name === membership.accountId)
            membership.name = (await lookupName({ id: membership.accountId, type: "account" })).name;
        membership.teamName = (await lookupName({ id: membership.teamId, type: "team" })).name;
        membership.updated = moment(membership.updated).toDate();
    }

    return result;
}

export interface TeamMembershipResult {
    teamId: string,
    owner: AccountId|OrganizationId,
    publicProps: TeamProperties,
    membership: TeamMembership|null,
    resources: Record<string,{count: number, limit: number }>,
    team: TeamDoc|null,
}

// get details of an invitation to a particular team (invitations must be asked for explicitly so the expected
// flow is that the team admin shares the invite link with the player out of band and when they go to the invite
// link it pulls their invite (if any) for the team in the link URL)
export async function getTeamMembership(teamId: string) : Promise<TeamMembershipResult>  {
    const method = "GET";
    const url = `${config.adminApiBaseUrl}/my-teams/${encodeURIComponent(teamId)}`;
    const result = await fetchJsonAndThrow<TeamMembershipResult>(url, { method });
    if (result.membership) {
        result.membership.updated = moment(result.membership.updated).toDate();
        if (result.membership.name === result.membership.accountId)
            result.membership.name = (await lookupName({ id: result.membership.accountId, type: "account" })).name;
    }
    result.owner = await lookupName(result.owner) as AccountId | OrganizationId;
    return result;
}

// respond to an existing invitation (accept). Teams won't show up in "my teams" list
// until the invite is accepted.
export async function acceptInvitation(teamId: string, prefs: TeamMemberPrefs): Promise<TeamMembership> {
    const method = "PUT";
    const url = `${config.adminApiBaseUrl}/my-teams/${encodeURIComponent(teamId)}`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify(prefs);
    const result = await fetchJsonAndThrow<TeamMembership>(url, { method, headers, body });
    if (result.name === result.accountId)
        result.name = (await lookupName({ id: result.accountId, type: "account" })).name;
    result.updated = moment(result.updated).toDate();
    return result;
}

export async function updateTeamMemberPrefs(teamId: string, prefs: TeamMemberPrefs): Promise<void> {
    const method = "PUT";
    const url = `${config.adminApiBaseUrl}/my-teams/${encodeURIComponent(teamId)}/prefs`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify(prefs);
    await fetchJsonAndThrow<void>(url, { method, headers, body });
}

// respond to an existing invitation (reject). Removes the invite from the team membership roster
export async function rejectInvitation(teamId: string): Promise<void> {
    const method = "DELETE";
    const url = `${config.adminApiBaseUrl}/my-teams/${encodeURIComponent(teamId)}`;
    await fetchJsonAndThrow<void>(url, { method });
}

///// TEAMS

// change the team owner to the desired account. Target account must already be a member with admin permissions. Calling user
// must be the current team owner or a superuser.
export async function transferTeamToUser(teamId: string, newOwnerAccountId: string) : Promise<TeamDoc> {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/team/${encodeURIComponent(teamId)}/transfer`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify({ accountId: newOwnerAccountId });

    const result = await fetchJsonAndThrow<TeamDoc>(url, { method, headers, body });
    result.owner = await lookupName(result.owner) as AccountId | OrganizationId;
    result.created = moment(result.created).toDate();
    result.updated = moment(result.updated).toDate();
    return result;
}

// delete a team
// must be the current team owner. Team cannot have more than 1 member or any projects.
export async function deleteTeam(teamId: string) : Promise<void> {
    const method = "DELETE";
    const url = `${config.publicContentApiBaseUrl_v2}/team/${encodeURIComponent(teamId)}`;
    await fetchJsonAndThrow<void>(url, { method });
}

// transfer a project owned by the current user to be instead owned by a team (which the current user must be an admin of)
export async function transferProject(projectId: string, teamId: string|null) : Promise<ProjectDoc> {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/transfer`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify({ teamId });

    const result = await fetchJsonAndThrow<ProjectDoc>(url, { method, headers, body });
    await fixupProject(result);
    return result;
}

// create a new team owned by the current user. Currently users are limited to owning no more than 2 teams.
export async function createTeam(props: TeamProperties): Promise<TeamDoc> {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/team`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify(props);

    const result = await fetchJsonAndThrow<TeamDoc>(url, { method, headers, body });
    result.owner = await lookupName(result.owner) as AccountId | OrganizationId;
    result.created = moment(result.created).toDate();
    result.updated = moment(result.updated).toDate();
    return result;
}

// get the team properties for a given team ID. Mostly just name / desc
export async function getTeamById(teamId: string): Promise<TeamDoc|undefined> {
    const method = "GET";
    const url = `${config.publicContentApiBaseUrl_v2}/team/${encodeURIComponent(teamId)}`;
    const result = await fetchJsonAndThrow<TeamDoc|undefined>(url, { method });
    if (!result)
        return undefined;
    result.owner = await lookupName(result.owner) as AccountId | OrganizationId;
    result.created = moment(result.created).toDate();
    result.updated = moment(result.updated).toDate();
    return result;
}

// get a list of projects (paged) owned by the specified team
export async function getTeamProjects(teamId: string, olderThan?: Date, archived?: "archived"): Promise<PagedResults<ProjectSearchResultSlim,Date>> {
    let url = `${config.publicContentApiBaseUrl_v2}/team/${encodeURIComponent(teamId)}/projects?`;
    if (olderThan !== undefined)
        url += `olderThan=${encodeURIComponent(olderThan.toISOString())}&`;
    if (archived)
        url += "archived=true&";

    const response = await fetchJsonAndThrow<PagedResults<ProjectSearchResultSlim,Date>>(url, { method: "GET" });
    if (response.next)
        response.next = moment(response.next).toDate();

    // prefetch (so all these requests are in parallel)
    for (const result of response.results)
        lookupName(result.info.owner).catch();

    for (const result of response.results) {
        result.info.owner = await lookupName(result.info.owner) as AccountId | TeamId;
        result.date = moment(result.date).toDate();
    }

    console.debug(`retrieved team project list. ${response.results.length >= response.limit ? "(has more)" : "done."}`, response.results);
    return response;
}

export async function getTicketDetails(ticketId: string): Promise<unknown> {
    const url = `${config.publicContentApiBaseUrl_v2}/ticket/${encodeURIComponent(ticketId)}/details`;
    return fetchJsonAndThrow(url, { method: "GET" });
}

// get a list of members (paged) and their access levels within the specified team. This also lists memberships that
// are pending acceptance.
export async function getTeamMembers(teamId: string, limit = 20, afterMember?: string): Promise<PagedResults<TeamMembership&{og_name:string, accountName:string},string>> {
    let url = `${config.publicContentApiBaseUrl_v2}/team/${encodeURIComponent(teamId)}/members?limit=${encodeURIComponent(limit)}`;
    if (afterMember)
        url += `&after=${encodeURIComponent(afterMember)}`;

    const response = await fetchJsonAndThrow<PagedResults<TeamMembership&{og_name:string, accountName:string},string>>(url, { method: "GET" });

    // prefetch (so all these requests are in parallel)
    for (const result of response.results)
        lookupName({ id: result.accountId, type: "account" }).catch();

    for (const result of response.results) {
        result.og_name = result.name;
        result.accountName =  (await lookupName({ id: result.accountId, type: "account" })).name;
        if (result.name === result.accountId)
            result.name = result.accountName;
        result.updated = moment(result.updated).toDate();
    }

    console.debug(`retrieved team member list. ${response.results.length >= response.limit ? "(has more)" : "done."}`, response.results);
    return response;
}

export async function getTeamPlaytesters(teamId: string, groupId: string, limit = 20, afterMember?: string): Promise<PagedResults<PlaytestGroupMembership & { accountName: string },string>> {
    let url = `${config.publicContentApiBaseUrl_v2}/team/${encodeURIComponent(teamId)}/playtesters/${encodeURIComponent(groupId)}?limit=${encodeURIComponent(limit)}`;
    if (afterMember)
        url += `&after=${encodeURIComponent(afterMember)}`;

    const response = await fetchJsonAndThrow<PagedResults<PlaytestGroupMembership & { accountName: string },string>>(url, { method: "GET" });

    // prefetch (so all these promises are in parallel)
    for (const result of response.results)
        lookupName({ id: result.accountId, type: "account" }).catch();

    for (const result of response.results) {
        result.accountName = (await lookupName({ id: result.accountId, type: "account" })).name;
        result.updated = moment(result.updated).toDate();
    }

    console.debug(`retrieved playtester list. ${response.results.length >= response.limit ? "(has more)" : "done."}`, response.results);
    return response;
}

// edit name/description for a team. If the team is renamed this also renames the owner for any team-owned projects
export async function editTeamProperties(teamId: string, props: TeamProperties): Promise<TeamDoc> {
    const method = "PUT";
    const url = `${config.publicContentApiBaseUrl_v2}/team/${encodeURIComponent(teamId)}`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify(props);

    const result = await fetchJsonAndThrow<TeamDoc>(url, { method, headers, body });
    result.owner = await lookupName(result.owner) as AccountId | OrganizationId;
    result.created = moment(result.created).toDate();
    result.updated = moment(result.updated).toDate();
    return result;
}

// invite new or edit the member name and access level for a given team member (or pending invitation)
export async function upsertTeamMember(teamId: string, accountId: string, memberName: string, access: Partial<Omit<AccessControl,"read">>|undefined): Promise<TeamMembership&{accountName:string}> {
    const method = "PUT";
    const url = `${config.publicContentApiBaseUrl_v2}/team/${encodeURIComponent(teamId)}/membership/${encodeURIComponent(accountId)}`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify({
        name: memberName,
        access: access,
    });

    const result = await fetchJsonAndThrow<TeamMembership&{accountName:string}>(url, { method, headers, body });
    result.accountName = (await lookupName({ id: result.accountId, type: "account" })).name;
    if (result.name === result.accountId)
        result.name = result.accountName;
    result.updated = moment(result.updated).toDate();
    return result;
}

// remove a team member or rescend a pending invitation
export async function removeTeamMember(teamId: string, accountId: string) : Promise<void> {
    const method = "DELETE";
    const url = `${config.publicContentApiBaseUrl_v2}/team/${encodeURIComponent(teamId)}/membership/${encodeURIComponent(accountId)}`;

    await fetchJsonAndThrow<void>(url, { method });
}
export async function removePlaytester(teamId: string, groupId: string, accountId: string) : Promise<void> {
    const method = "DELETE";
    const url = `${config.publicContentApiBaseUrl_v2}/team/${encodeURIComponent(teamId)}/playtesters/${encodeURIComponent(groupId)}/${encodeURIComponent(accountId)}`;

    await fetchJsonAndThrow<void>(url, { method });
}

export async function createModuleVersionWithDelta(moduleId: string) : Promise<void> {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/module/${encodeURIComponent(moduleId)}`;

    await fetchJsonAndThrow<void>(url, { method });
}

export async function reportExternalPublish(projectId: string, mnemonic: string, version: number) : Promise<PublishedLink> {
    const method = "PUT";
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/report-ext-publish`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify({mnemonic, version});

    return await fetchJsonAndThrow<PublishedLink>(url, { method, headers, body });
}

export async function reportExternalBuild(projectId: string, mnemonic: string, version: number) : Promise<PublishedLink> {
    const method = "PUT";
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/report-ext-build`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify({mnemonic, version});

    return await fetchJsonAndThrow<PublishedLink>(url, { method, headers, body });
}

export async function createPlaytestGroup(teamId: string, name: string) : Promise<PlaytestGroup> {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/team/${encodeURIComponent(teamId)}/playtest`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify({ name });

    return await fetchJsonAndThrow<PlaytestGroup>(url, { method, headers, body });
}

export async function removePlaytestGroup(teamId: string, groupId: string) : Promise<void> {
    const method = "DELETE";
    const url = `${config.publicContentApiBaseUrl_v2}/team/${encodeURIComponent(teamId)}/playtest/${encodeURIComponent(groupId)}`;

    return await fetchJsonAndThrow<void>(url, { method });
}

export async function createJoinCode(teamId: string, groupId: string, code: PlaytestJoinCode) : Promise<PlaytestGroup> {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/team/${encodeURIComponent(teamId)}/playtest/${encodeURIComponent(groupId)}/code`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify(code);

    return await fetchJsonAndThrow<PlaytestGroup>(url, { method, headers, body });
}

export async function removeJoinCode(teamId: string, groupId: string, code: string) : Promise<void> {
    const method = "DELETE";
    const url = `${config.publicContentApiBaseUrl_v2}/team/${encodeURIComponent(teamId)}/playtest/${encodeURIComponent(groupId)}/code/${encodeURIComponent(code)}`;

    return await fetchJsonAndThrow<void>(url, { method });
}

export async function useJoinCode(teamId: string, code: string) : Promise<void> {
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v2}/team/${encodeURIComponent(teamId)}/code/${encodeURIComponent(code)}/join`;

    return await fetchJsonAndThrow<void>(url, { method });
}

export async function getJoinCodeInfo(teamId: string, code: string) : Promise<JoinCodeInfo> {
    const method = "GET";
    const url = `${config.publicContentApiBaseUrl_v2}/team/${encodeURIComponent(teamId)}/code/${encodeURIComponent(code)}`;

    return await fetchJsonAndThrow<JoinCodeInfo>(url, { method });
}

export async function updateProjectDataAuthority(projectId: string, dataAuthority?: string, hasUEFNData?: boolean) : Promise<void> {
    const method = "PUT";
    const url = `${config.publicContentApiBaseUrl_v2}/project/${encodeURIComponent(projectId)}/update-project-data-authority`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify({dataAuthority, hasUEFNData});

    return await fetchJsonAndThrow<void>(url, { method, headers, body });
}

export async function startKwsAdultVerification(): Promise<{redirect: string}> {
    const method = "POST";
    const url = `${config.identityApiBaseUrl}/my-identity/kws/verify`;
    const headers = { ...DefaultHeaders };
    const onComplete = window.location.href;
    const body = JSON.stringify({ context: "adult", onComplete });

    return await fetchJsonAndThrow<{redirect: string}>(url, { method, headers, body });
}

export async function getKwsVerificationStatuses(): Promise<{ av: boolean }> {
    const method = "GET";
    const url = `${config.identityApiBaseUrl}/my-identity/kws`;
    const headers = { ...DefaultHeaders };

    const xhr = await fetchJson<{av: boolean}>(url, { method, headers });
    if (!xhr.success) {
        if (xhr.response.errorCode.endsWith("content-service.status_unknown"))
            return { av: false };
        else
            throw xhr.response;
    }
    return xhr.response;
}

export async function triggerModuleFileZipJob(moduleId: string, version: number, jobPlatform: JobPlatform) : Promise<void>  {
    const method = "POST";
    const url = `${config.adminApiBaseUrl}/module/${encodeURIComponent(moduleId)}/version/${version}/zip-files?jobPlatform=${jobPlatform}`;

    console.debug("triggering file zip job");
    await fetch(url, { method, headers: RequestorHeader });
}

export async function downloadInvalidScratchContent(jobId: string) : Promise<Response>  {
    const method = "GET";
    const url = `${config.adminApiBaseUrl}/job/${encodeURIComponent(jobId)}/invalid-scratch-content`;

    console.debug("Downloading invalid scratch content for UCS validation job: " + jobId);

    const file = await fetch(url, { method, headers: RequestorHeader }).then(async (rsp) => {
        if (!rsp.ok){
                let errorMessage = `http ${rsp.status} from ${url}`
                throw new Error(errorMessage);
            }
        return rsp;
    });
    if (file.ok) {
        return file;
    }

    throw new Error(`http 404 from ${url}`);
}

export async function isFeatureFlagEnabled(flagId: string) : Promise<boolean> {
    const method = "GET";
    const url = `${config.adminApiBaseUrl}/config/feature-flag/${flagId}`;
    const result = await fetchJsonAndThrow<boolean>(url, { method });
    return result;
}
export async function getDefaultJobPlatform() : Promise<JobPlatform> {
    const method = "GET";
    const url = `${config.publicContentApiBaseUrl_v2}/config/default-job-platform`;
    const result = await fetchJsonAndThrow<{ jobPlatform: JobPlatform }>(url, { method });
    return result.jobPlatform;
}

export async function getStaticModule(staticModuleId: string) : Promise<StaticModuleDoc> {
    const method = "GET";
    const url = `${config.adminApiBaseUrl}/v2/static/module/${encodeURIComponent(staticModuleId)}`;
    const headers = { ...DefaultHeaders };
    return await fetchJsonAndThrow<StaticModuleDoc>(url, { method, headers });
}

export async function findStaticModules(versePath: string, version: BuildVersion) : Promise<StaticModuleDoc[]> {
    const method = "GET";
    const url = `${config.adminApiBaseUrl}/v2/static/module/find/${encodeURIComponent(versePath)}?major=${version.major}&minor=${version.minor}&patch=${version.patch}`;
    const headers = { ...DefaultHeaders };
    return await fetchJsonAndThrow<StaticModuleDoc[]>(url, { method, headers });
}

export async function getHotfixes(): Promise<HotfixInfo[]> {
    const method = "GET";
    const url = `${config.adminApiBaseUrl}/hotfix/list`;
    const headers = { ...DefaultHeaders };

    const response = await fetchJsonAndThrow<PagedResults<HotfixInfo,Date>>(url, { method, headers });
    for (const result of response.results) {
        result.updated = moment(result.updated).toDate();
    }
    return response.results;
}

export async function getHotfixAssignments(): Promise<Record<string, HotfixAssignmentDoc>> {
    const method = "GET";
    const url = `${config.adminApiBaseUrl}/hotfix/assignments`;
    const headers = { ...DefaultHeaders };

    const response = await fetchJsonAndThrow<Record<string, HotfixAssignmentDoc>>(url, { method, headers });
    return response;
}

export async function uploadHotfix(hotfixUploadRequest : HotfixUploadRequest, hotfixFile : Blob): Promise<void> {
    const method = "POST";
    const url = `${config.adminApiBaseUrl}/hotfix/upload`;

    const body = new FormData();
    body.append("file", hotfixFile, "filename.zip");
    body.append("uploadRequest", JSON.stringify(hotfixUploadRequest));

    const result = await fetchJsonAndThrow<void>(url, { method, body });
    console.debug("uploadHotfix complete", result);
}

export async function updateHotfix(hotfixUpdateRequest : HotfixUpdateRequest): Promise<void> {
    const method = "PUT";
    const url = `${config.adminApiBaseUrl}/hotfix/update`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify(hotfixUpdateRequest);

    const result = await fetchJsonAndThrow<void>(url, { method, headers, body });
    console.debug("updateHotfix complete", result);
}

export async function applyHotfix(hotfixApplyRequest : HotfixApplyRequest): Promise<void> {
    const method = "PUT";
    const url = `${config.adminApiBaseUrl}/hotfix/apply?replaceExisting=true`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify(hotfixApplyRequest);

    const result = await fetchJsonAndThrow<void>(url, { method, headers, body });
    console.debug("applyHotfix complete", result);
}

export async function deleteHotfix(hotfixId : string): Promise<void> {
    const method = "DELETE";
    const url = `${config.adminApiBaseUrl}/hotfix/delete/${encodeURIComponent(hotfixId)}`;
    const headers = { ...DefaultHeaders };

    const result = await fetchJsonAndThrow<void>(url, { method, headers });
    console.debug("deleteHotfix complete", result);
}

export async function cleanupHotfixes(age : number, isPreview : boolean = false): Promise<string[]> {
    const method = "POST";
    const url = `${config.adminApiBaseUrl}/hotfix/cleanup`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify({ ageInDays: age, preview: isPreview });

    const result = await fetchJsonAndThrow<string[]>(url, { method, headers, body });
    console.log(`${isPreview ? "[PREVIEW]" : ""} CleanupHotfixes complete`, result);

    return result ?? [];
}

export async function downloadHotfix(hotfixId : string): Promise<Response> {
    const method = "GET";
    const url = `${config.adminApiBaseUrl}/hotfix/download/${encodeURIComponent(hotfixId)}`;
    const file = await fetch(url, { method, headers: RequestorHeader }).then(async (rsp) => {
        if (!rsp.ok)
            throw new Error(`http ${rsp.status} from ${url}`);
        return rsp;
    });
    return file;
}

export async function blockPromoteBuildCode(projectId: string, enable: boolean): Promise<void> {
    const method = enable ? "PUT" : "DELETE";
    const url = `${config.adminApiBaseUrl}/project/${encodeURIComponent(projectId)}/promote_build_code/block`;
    const headers = { ...DefaultHeaders };

    await fetchJsonAndThrow<void>(url, { method, headers });
}

export async function resolveRedirects(fromVersion: string, toVersion: string) {
    const method = "GET";
    const url = `${config.adminApiBaseUrl}/redirect/resolve/cookversion/range?generateLink=false&fromVersion=${fromVersion}&toVersion=${toVersion}`;
    const headers = { ...DefaultHeaders };
    const result = await fetchJsonAndThrow<void>(url, { method, headers });
    return result;
}

export async function resolveRedirectsForModule(moduleId: string, moduleVersion: number, toVersion: string) {
    const method = "GET";
    const url = `${config.adminApiBaseUrl}/redirect/resolve/module/${moduleId}/version/${moduleVersion}?generateLink=false&toVersion=${toVersion}`;
    const headers = { ...DefaultHeaders };
    const result = await fetchJsonAndThrow<void>(url, { method, headers });
    return result;
}

export async function findWorkspacesByOwner(ownerId: string, limit = 20, afterName?: string)
{
    let url = `${config.publicContentApiBaseUrl_v4}/team/${encodeURIComponent(ownerId)}/workspaces?limit=${encodeURIComponent(limit)}`;
    if (afterName)
        url += `&afterName=${encodeURIComponent(afterName)}`;

    const response = await fetchJsonAndThrow<PagedResults<WorkspaceDoc&{creatorName: string},string>>(url, { method: "GET" });

    // prefetch (so all these requests are in parallel)
    for (const result of response.results)
        lookupName(result.creator).catch();

    for (const result of response.results) {
        result.creatorName =  (await lookupName(result.creator)).name;
        result.created = moment(result.created).toDate();

        // undefined doesn't come down the wire explicitly, and KO needs it for optional props.
        result.notes = result.notes || undefined;
        result.parentId = result.parentId || undefined;
        result.lastPublished = result.lastPublished && moment(result.lastPublished).toDate() || undefined;
    }

    console.debug(`retrieved workspacedoc list 1. ${response.results.length >= response.limit ? "(has more)" : "done."}`, response.results);
    return response;
}

export async function createWorkspace(request: CreateWorkspaceRequest): Promise<WorkspaceDoc>
{
    const method = "POST";
    const url = `${config.publicContentApiBaseUrl_v4}/workspace`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify(request);

    const result = await fetchJsonAndThrow<WorkspaceDoc>(url, { method, headers, body });
    result.created = moment(result.created).toDate();

    // undefined doesn't come down the wire explicitly, and KO needs it for optional props.
    result.notes = result.notes || undefined;
    result.parentId = result.parentId || undefined;
    result.lastPublished = result.lastPublished && moment(result.lastPublished).toDate() || undefined;

    return result;
}

export async function updateWorkspace(workspaceId: string, request: UpdateWorkspaceRequest): Promise<WorkspaceDoc>
{
    const method = "put";
    const url = `${config.publicContentApiBaseUrl_v4}/workspace/${encodeURIComponent(workspaceId)}`;
    const headers = { ...DefaultHeaders };
    const body = JSON.stringify(request);

    const result = await fetchJsonAndThrow<WorkspaceDoc>(url, { method, headers, body });
    result.created = moment(result.created).toDate();

    // undefined doesn't come down the wire explicitly, and KO needs it for optional props.
    result.notes = result.notes || undefined;
    result.parentId = result.parentId || undefined;
    result.lastPublished = result.lastPublished && moment(result.lastPublished).toDate() || undefined;

    return result;
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
    const method = "DELETE";
    const url = `${config.publicContentApiBaseUrl_v4}/workspace/${encodeURIComponent(workspaceId)}`;
    const headers = { ...DefaultHeaders };

    const result = await fetchJsonAndThrow<void>(url, { method, headers });
    console.debug(`delete workspacedoc ${workspaceId}`, result);
}