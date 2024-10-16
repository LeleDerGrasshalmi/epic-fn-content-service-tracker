import { FInventoryItem } from "./inventory-item";


/** Check non-null, require absolute path and change the path to be relative */
function checkMatchString(matchString: string): string
{
    // non-null
    if (!matchString)
        throw new Error("non-null inventory path is required.");

    // absolute path
    if (!matchString.startsWith("/"))
        throw new Error("absolute path to item is required.");

    // change to relative path
    return matchString.substr(1);
}

/** (C++) FInventory - Inventory.cpp */
export class FInventory
{
    public readonly rootItem: FInventoryItem = new FInventoryItem(this, "");

    /** FInventory::FindOrCreateItem */
    public findOrCreateItem(inMatchString: string): FInventoryItem | undefined
    {
        const matchString = checkMatchString(inMatchString);
        return (!matchString)
            ? this.rootItem
            : this.rootItem.findOrCreateItem(matchString, 0);
    }
}