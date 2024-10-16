import { BuildVersion, HotfixFlag } from "@app/types";

export function parseBuildString(buildstr: string): BuildVersion
{
    // validate build string.
    const m = buildstr.match(/^([^.]+)(\.(\d+))?(\.(\d+))?$/);
    if (m === null)
        throw new Error(`Invalid build version '${buildstr}'. Regex fail.`);

    // parse major and minor version parts.
    let major : string | number = m[1].trim();
    let minor = parseVersionComponent(m[3]);
    let patch = parseVersionComponent(m[5]);
    if (!major)
        throw new Error(`Invalid build version '${buildstr}'. Blank major.`);
    if (minor < 0 || patch < 0)
        throw new Error(`Invalid build version '${buildstr}'. Negative minor/patch.`);
    if (isNaN(parseVersionComponent(major))) {
        // allow "main.123" to mean main.0.123 (and "main" to mean main.0)
        if (isNaN(patch))
        {
            patch = isNaN(minor) ? 0 : minor;
            minor = 0;
        }
    }
    else if (isNaN(minor)) {
        // minor must be specified for numeric branches
        throw new Error(`Invalid build version '${buildstr}'. Major and minor must be specified for numeric builds.`);
    }
    else {
        major = parseVersionComponent(major);
    }
    return { major, minor, patch };
}

export const parseVersionComponent = function(val: string): number {
    const n = Number(val);
    return Number.isInteger(n) && n >= 0 ? n : NaN;
}

//////////////////////////////////////////////////////////////////////////
/// NOTE: Not currently possible to share constants & functions between src & www
/// - so below are copies from the src declarations
//////////////////////////////////////////////////////////////////////////

//Break down a cook image tag such as "fn-26.0.27130025-live-testing" into match images which can be compared against hotfix assignments
export function breakImageTagIntoMatchImages(imageTag: string) : string[] {
    const parts = imageTag.split(".");

    //Remove the environment tag (eg. 'gamedev', 'live-testing') from the tag
    if(parts.length > 1) {
        const finalPart = parts[parts.length - 1];
        const dash = finalPart.indexOf("-");
        parts[parts.length - 1] = finalPart.substring(0, dash);
    }

    //Build the matchimage strings in order of increasing length eg. 26.0.247373 becomes ["26.0.247373", "26.0", "26"]
    const matchImages = [ ];
    for(let i = parts.length; i > 0; i--)
    {
        const matchTag = parts.slice(0, i).join(".").toLowerCase();
        matchImages.push(matchTag);
    }

    return matchImages;
}

export const AllHotfixFlags : HotfixFlag[] = ["overrideCacheKey", "disableCleanup", "autotested"];