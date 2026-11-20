/** Called only after GLB structural/accessor bounds and finite floats have been
 * checked. No resource resolution, engine execution or asset quality claim. */
export function inspectGlbSkins(doc: Record<string, any>, bin: Buffer) {
  const accessors = doc.accessors ?? [], views = doc.bufferViews ?? [], skins = doc.skins ?? [], nodes = doc.nodes ?? [];
  const invalid = (why: string): never => { throw Error(`Invalid/self-contained GLB: skin ${why}`); };
  const sizes: Record<number, number> = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
  const dimensions: Record<string, number> = { VEC4: 4, MAT4: 16 };
  const decoded = new Map<number, Float64Array>(); let scalars = 0;
  function values(index: number) {
    if (decoded.has(index)) return decoded.get(index)!;
    const a = accessors[index], width = dimensions[a.type] ?? invalid("accessor dimension");
    if (!width || !sizes[a.componentType] || !Number.isSafeInteger(a.count) || a.count < 1) invalid("accessor shape");
    scalars += a.count * width; if (scalars > 24000000) invalid("inspection working budget exceeded");
    const data = new Float64Array(a.count * width);
    const read = (view: any, start: number, type: number, element: number, component: number, dimension: number) => {
      const offset = (view.byteOffset ?? 0) + start + element * (view.byteStride ?? sizes[type]! * dimension) + component * sizes[type]!;
      return type === 5126 ? bin.readFloatLE(offset) : type === 5121 ? bin.readUInt8(offset) : type === 5123 ? bin.readUInt16LE(offset) : bin.readUInt32LE(offset);
    };
    if (a.bufferView !== undefined) for (let i = 0; i < a.count; i++) for (let j = 0; j < width; j++)
      data[i * width + j] = read(views[a.bufferView], a.byteOffset ?? 0, a.componentType, i, j, width);
    if (a.sparse) {
      const s = a.sparse; let previous = -1;
      for (let i = 0; i < s.count; i++) {
        const vertex = read(views[s.indices.bufferView], s.indices.byteOffset ?? 0, s.indices.componentType, i, 0, 1);
        if (vertex <= previous || vertex >= a.count) invalid("sparse indices order/range"); previous = vertex;
        for (let j = 0; j < width; j++) data[vertex * width + j] = read(views[s.values.bufferView], s.values.byteOffset ?? 0, a.componentType, i, j, width);
      }
    }
    if (a.normalized) { const divisor = a.componentType === 5121 ? 255 : a.componentType === 5123 ? 65535 : invalid("normalized accessor type"); for (let i = 0; i < data.length; i++) data[i] = data[i]! / divisor; }
    decoded.set(index, data); return data;
  }
  type Stats = { vertices: number; mixed: number; maxJoint: number; maxInfluences: number };
  const meshes: (Stats | undefined)[][] = (doc.meshes ?? []).map((mesh: any) => mesh.primitives.map((primitive: any) => {
    const attributes = primitive.attributes ?? {}, names = Object.keys(attributes).filter(name => /^(?:JOINTS|WEIGHTS)_/.test(name));
    if (!names.length) return undefined;
    if (names.some(name => !/^(?:JOINTS|WEIGHTS)_[01]$/.test(name)) || attributes.JOINTS_0 === undefined || attributes.WEIGHTS_0 === undefined) invalid("attribute sets require consecutive JOINTS/WEIGHTS pairs (at most eight influences)");
    const sets = [] as { joints: Float64Array; weights: Float64Array }[];
    for (let set = 0; set < 2; set++) {
      const jointIndex = attributes[`JOINTS_${set}`], weightIndex = attributes[`WEIGHTS_${set}`];
      if (jointIndex === undefined && weightIndex === undefined) continue;
      if (jointIndex === undefined || weightIndex === undefined) invalid("unpaired joints/weights");
      const j = accessors[jointIndex], w = accessors[weightIndex];
      if (j.type !== "VEC4" || ![5121, 5123].includes(j.componentType) || j.normalized !== undefined && j.normalized !== false) invalid("joint accessor type/normalization");
      if (w.type !== "VEC4" || ![5121, 5123, 5126].includes(w.componentType) || (w.componentType === 5126 ? w.normalized !== undefined && w.normalized !== false : w.normalized !== true)) invalid("weight accessor type/normalization");
      sets.push({ joints: values(jointIndex), weights: values(weightIndex) });
    }
    const count = accessors[attributes.POSITION].count; let mixed = 0, maxJoint = -1, maxInfluences = 0;
    for (let vertex = 0; vertex < count; vertex++) {
      let total = 0; const used = new Set<number>();
      for (const set of sets) for (let i = 0; i < 4; i++) {
        const joint = set.joints[vertex * 4 + i]!, weight = set.weights[vertex * 4 + i]!;
        if (!Number.isInteger(joint) || joint < 0 || !Number.isFinite(weight) || weight < 0 || weight > 1) invalid("joint/weight value");
        maxJoint = Math.max(maxJoint, joint); total += weight;
        if (weight > 0) { if (used.has(joint)) invalid("duplicate nonzero influence"); used.add(joint); }
      }
      // This qualified processing path requires normalized weights even for
      // floats, where glTF specifies a recommendation rather than a MUST.
      if (Math.abs(total - 1) > 1e-5) invalid("weights must sum to one in the qualified path");
      if (used.size > 1) mixed++; maxInfluences = Math.max(maxInfluences, used.size);
    }
    return { vertices: count, mixed, maxJoint, maxInfluences };
  }));
  const parents=new Map<number,number>(),roots=new Map<number,number>();
  nodes.forEach((node:any,index:number)=>{for(const child of node.children??[])parents.set(child,index);});
  const root=(index:number)=>{const path:number[]=[];let current=index;while(parents.has(current)&&!roots.has(current)){path.push(current);current=parents.get(current)!;}const result=roots.get(current)??current;for(const node of path)roots.set(node,result);return result;};
  for (const skin of skins) {
    if (!Array.isArray(skin.joints) || !skin.joints.length || new Set(skin.joints).size !== skin.joints.length) invalid("joints must be nonempty and unique");
    if(new Set(skin.joints.map(root)).size!==1)invalid("joints require a common hierarchy root");
    if (skin.skeleton !== undefined && (!Number.isInteger(skin.skeleton) || !nodes[skin.skeleton])) invalid("skeleton reference");
    if(skin.skeleton!==undefined)for(const joint of skin.joints){let node:number|undefined=joint;while(node!==undefined&&node!==skin.skeleton)node=parents.get(node);if(node===undefined)invalid("skeleton must be an ancestor of all joints");}
    if (skin.inverseBindMatrices !== undefined) {
      const a = accessors[skin.inverseBindMatrices];
      if (a.type !== "MAT4" || a.componentType !== 5126 || a.normalized || a.count < skin.joints.length) invalid("inverse bind matrix type/count");
      const matrices = values(skin.inverseBindMatrices);
      for (let i = 0; i < skin.joints.length; i++) for (let j = 0; j < 4; j++) if (Math.abs(matrices[i * 16 + j * 4 + 3]! - (j === 3 ? 1 : 0)) > 1e-5) invalid("inverse bind homogeneous row");
    }
  }
  const usedMeshes = new Set<number>();
  for (const node of nodes) if (node.skin !== undefined) {
    if (node.mesh === undefined) invalid("bound node requires a mesh");
    const skin = skins[node.skin];
    for (const primitive of meshes[node.mesh]!) if (!primitive || primitive.maxJoint >= skin.joints.length) invalid("missing attributes or joint outside bound skin");
    usedMeshes.add(node.mesh);
  }
  let skinnedVertices = 0, mixedWeightVertices = 0, maxSkinInfluences = 0;
  for (const index of usedMeshes) for (const primitive of meshes[index]!) {
    skinnedVertices += primitive!.vertices; mixedWeightVertices += primitive!.mixed; maxSkinInfluences = Math.max(maxSkinInfluences, primitive!.maxInfluences);
  }
  return { skinnedVertices, mixedWeightVertices, maxSkinInfluences };
}
