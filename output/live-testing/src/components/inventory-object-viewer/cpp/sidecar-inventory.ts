import { FInventory } from "./inventory";
import { FInventoryItem } from "./inventory-item";
import { FJsonObject, FJsonValue, EJsonNull, EJsonNone } from "./f-json-types";

// ******************************************************************************
// * this should always remain a translation of the C++ implementation.
// * see: USidecarInventorySys::ApplyUpdateToInventory (SidecarInventory.cpp)
// * see: FInventory::FindOrCreateItem (Inventory.cpp)
// * see: FInventoryItem::UpdateValueFromJson (InventoryItem.cpp)
// ******************************************************************************


export function ApplyUpdateToInventory(inventory: FInventory, jsonBody: FJsonObject): void
{
    // make sure we process the keys in a deterministic order (in case there's bugs we want them to be reproducible)
    const it = Object.entries(jsonBody).sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    // populate it
    for(const [key, value] of it)
    {
        let newValue: FJsonValue = value;
        if (newValue === EJsonNull || newValue === EJsonNone)
        {
            // make sure JSON null values are treated as no root object
            newValue = {};
        }

        // create the sub-item
        const item: FInventoryItem | undefined = inventory.findOrCreateItem(key);
        if (item === undefined)
        {
            console.warn(`Unable to set item at illegal path '%s'`, key);
            continue;
        }

        // populate the sub item we found/created
        item.updateValueFromJson(newValue, true);
    }
}