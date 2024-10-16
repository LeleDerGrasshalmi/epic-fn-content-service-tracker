export function isLegalItemPath(segment: string, bAllowSlash: boolean): boolean
{
    if (segment === null || segment === undefined)
        throw new Error("argument null: segment");

    // "" is not allowed for a segment (though it is allowed as a special case for a full absolute path)
	if (segment.length <= 0)
	{
		return false;
	}

	// check for illegal characters
	let pathStart = -1;
	for (let i = 0; i < segment.length; ++i)
	{
		const ch = segment[i];

		// lower case only
		if (ch >= 'a' && ch <= 'z')
			continue;

		// numbers
		if (ch >= '0' && ch <= '9')
			continue;

		// path segments must start with a-z0-9 (checked already above)
		if (i === pathStart + 1)
			return false;

		// slash (conditional)
		if (ch === '/')
		{
			if (bAllowSlash)
			{
				pathStart = i;
				continue;
			}
			return false;
		}

		// any other exceptions
		switch (ch)
		{
            case '-':
            case '_':
            case '.':
                break;

            default:
                // illegal character
                return false;
		}
	}

	return true;
}