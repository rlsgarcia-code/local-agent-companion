"""Pinned recipe interpreter. No project Python, expressions, plugins or .blend input.
Runs only inside the offline bounded tool container, never in the user's editor.
"""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path('/work/output')


def color(value):
    # Scene inputs are sRGB; Blender node colors use linear RGB.
    values = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5, 7)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values[:3]) + (values[3],)


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def output_path(base, suffix):
    value = (ROOT / (base + suffix)).resolve()
    if not value.is_relative_to(ROOT):
        raise ValueError('Output path outside private work directory')
    value.parent.mkdir(parents=True, exist_ok=True)
    return str(value)


def process():
    payload = json.loads(Path('/source/recipe.json').read_text(), parse_constant=lambda v: (_ for _ in ()).throw(ValueError(v)))
    recipe, sources = payload['operation'], payload['sources']

    def source(name):
        file = (Path('/source') / sources[name]).resolve(strict=True)
        if not file.is_relative_to(Path('/source/files')):
            raise ValueError('Source path outside registered private inputs')
        return str(file)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    scene = bpy.context.scene
    scene.render.fps = recipe['fps']
    materials = {}
    for item in recipe['materials']:
        material = bpy.data.materials.new(item['id'])
        material.use_nodes = True
        node = material.node_tree.nodes.get('Principled BSDF')
        node.inputs['Base Color'].default_value = color(item['color'])
        node.inputs['Alpha'].default_value = color(item['color'])[3]
        node.inputs['Metallic'].default_value = item['metallic']
        node.inputs['Roughness'].default_value = item['roughness']
        node.inputs['Emission Color'].default_value = color(item['emission'])
        if item.get('texture'):
            image = bpy.data.images.load(source(item['texture']['path']), check_existing=True)
            image.pack()
            texture = material.node_tree.nodes.new('ShaderNodeTexImage')
            texture.image = image
            material.node_tree.links.new(texture.outputs['Color'], node.inputs['Base Color'])
            material.node_tree.links.new(texture.outputs['Alpha'], node.inputs['Alpha'])
        materials[item['id']] = material

    objects, export_objects = {}, []
    for item in recipe['objects']:
        geometry = item['geometry']
        kind = geometry['kind']
        if kind == 'glb':
            previous = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=source(geometry['source']['path']))
            imported = list(set(bpy.data.objects) - previous)
            if len(imported) > 512:
                raise ValueError('Imported hierarchy exceeds 512 objects')
            for obj in list(imported):
                if obj.type in ('CAMERA', 'LIGHT'):
                    bpy.data.objects.remove(obj, do_unlink=True)
                    imported.remove(obj)
            obj = bpy.data.objects.new(item['id'], None)
            scene.collection.objects.link(obj)
            for child in imported:
                if child.parent not in imported:
                    child.parent = obj
            meshes = [m for m in imported if m.type == 'MESH']
            export_objects.extend(imported)
        else:
            if kind == 'box':
                bpy.ops.mesh.primitive_cube_add(size=1)
                bpy.context.object.scale = geometry['size']
                bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            elif kind == 'sphere':
                bpy.ops.mesh.primitive_uv_sphere_add(radius=geometry['radius'], segments=geometry['segments'], ring_count=geometry['rings'])
            elif kind == 'cylinder':
                bpy.ops.mesh.primitive_cylinder_add(radius=geometry['radius'], depth=geometry['depth'], vertices=geometry['segments'])
            elif kind == 'cone':
                bpy.ops.mesh.primitive_cone_add(radius1=geometry['radius'], radius2=geometry['tipRadius'], depth=geometry['depth'], vertices=geometry['segments'])
            elif kind == 'torus':
                bpy.ops.mesh.primitive_torus_add(major_radius=geometry['radius'], minor_radius=geometry['tubeRadius'], major_segments=48, minor_segments=12)
            elif kind == 'plane':
                bpy.ops.mesh.primitive_plane_add(size=1)
                bpy.context.object.scale = (*geometry['size'], 1)
                bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            elif kind == 'mesh':
                mesh = bpy.data.meshes.new(item['id'])
                mesh.from_pydata(geometry['vertices'], [], geometry['triangles'])
                mesh.update()
                obj = bpy.data.objects.new(item['id'], mesh)
                scene.collection.objects.link(obj)
                bpy.ops.object.select_all(action='DESELECT')
                obj.select_set(True)
                bpy.context.view_layer.objects.active = obj
                bpy.ops.object.mode_set(mode='EDIT')
                bpy.ops.mesh.select_all(action='SELECT')
                bpy.ops.uv.smart_project()
                bpy.ops.object.mode_set(mode='OBJECT')
            else:
                raise ValueError('Unsupported model geometry')
            obj = bpy.context.object if kind != 'mesh' else obj
            meshes = [obj]
            if item['bevel']:
                modifier = obj.modifiers.new('Companion bevel', 'BEVEL')
                modifier.width, modifier.segments = item['bevel'], 2
            if item['subdivision']:
                modifier = obj.modifiers.new('Companion subdivision', 'SUBSURF')
                modifier.levels = modifier.render_levels = item['subdivision']
            for polygon in obj.data.polygons:
                polygon.use_smooth = item['smooth']
        obj.name = item['id']
        obj.location, obj.rotation_euler, obj.scale = item['position'], tuple(math.radians(v) for v in item['rotation']), item['scale']
        if item.get('material'):
            for mesh in meshes:
                mesh.data.materials.clear()
                mesh.data.materials.append(materials[item['material']])
        objects[item['id']] = obj
        export_objects.append(obj)
    for item in recipe['objects']:
        if item.get('parent'):
            objects[item['id']].parent = objects[item['parent']]

    rig = None
    if not recipe.get('rig') and any(item.get('skin') or item.get('bindBone') for item in recipe['objects']):
        raise ValueError('Bound meshes require an explicit rig')
    if recipe.get('rig'):
        data = bpy.data.armatures.new(recipe['rig']['id'])
        rig = bpy.data.objects.new(recipe['rig']['id'], data)
        scene.collection.objects.link(rig)
        bpy.ops.object.select_all(action='DESELECT')
        rig.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode='EDIT')
        for item in recipe['rig']['bones']:
            bone = data.edit_bones.new(item['id'])
            bone.head, bone.tail = item['head'], item['tail']
        for item in recipe['rig']['bones']:
            if item.get('parent'):
                data.edit_bones[item['id']].parent = data.edit_bones[item['parent']]
        bpy.ops.object.mode_set(mode='OBJECT')
        skinned_vertices, influence_count = 0, 0
        for item in recipe['objects']:
            if item.get('bindBone') or item.get('skin'):
                obj = objects[item['id']]
                obj.parent = rig
                if item.get('skin'):
                    weights = item['skin']['weights']
                    if item.get('bindBone') or item.get('parent') or item['geometry']['kind'] != 'mesh' or item['bevel'] or item['subdivision'] or len(weights) != len(obj.data.vertices):
                        raise ValueError('Weighted skin requires original explicit mesh topology')
                    skinned_vertices += len(weights)
                    influence_count += sum(len(row) for row in weights)
                    if skinned_vertices > 50000 or influence_count > 200000:
                        raise ValueError('Weighted skin working budget exceeded')
                    groups = {}
                    for vertex, row in enumerate(weights):
                        total = sum(entry['weight'] for entry in row)
                        if not 1 <= len(row) <= 4 or len({entry['bone'] for entry in row}) != len(row) or not math.isfinite(total) or abs(total - 1.0) > 1e-6:
                            raise ValueError('Distinct normalized skin influences required')
                        for entry in row:
                            bone, weight = entry['bone'], entry['weight']
                            if bone not in data.bones or not math.isfinite(weight) or not 0 < weight <= 1:
                                raise ValueError('Invalid skin bone/weight')
                            if bone not in groups:
                                groups[bone] = obj.vertex_groups.new(name=bone)
                            groups[bone].add([vertex], weight / total, 'REPLACE')
                else:
                    group = obj.vertex_groups.new(name=item['bindBone'])
                    group.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
                modifier = obj.modifiers.new('Companion rig', 'ARMATURE')
                modifier.object = rig
                modifier.use_vertex_groups = True
                modifier.use_bone_envelopes = False
                # glTF uses linear blend skinning; do not silently author
                # Blender-only dual-quaternion preserve-volume behavior.
                modifier.use_deform_preserve_volume = False
        export_objects.append(rig)

    # Separate NLA tracks with shared clip names preserve multi-object/bone clips.
    for clip in recipe['clips']:
        touched = set()
        for track in clip['tracks']:
            target = objects[track['target']['id']] if track['target']['kind'] == 'object' else rig.pose.bones[track['target']['id']]
            owner = target if track['target']['kind'] == 'object' else rig
            if owner not in touched:
                owner.animation_data_create()
                owner.animation_data.action = bpy.data.actions.new(f"{clip['id']}:{owner.name}")
                touched.add(owner)
            channel = {'position': 'location', 'rotation': 'rotation_euler', 'scale': 'scale'}[track['channel']]
            if channel == 'rotation_euler':
                target.rotation_mode = 'XYZ'
            for key in sorted(track['keys'], key=lambda k: k['frame']):
                value = tuple(math.radians(v) for v in key['value']) if channel == 'rotation_euler' else key['value']
                setattr(target, channel, value)
                target.keyframe_insert(data_path=channel, frame=key['frame'])
        for owner in touched:
            action = owner.animation_data.action
            track = owner.animation_data.nla_tracks.new()
            track.name = clip['id']
            strip = track.strips.new(clip['id'], 0, action)
            strip.frame_end = max(1, clip['frames'])
            owner.animation_data.action = None
    scene.frame_end = max([clip['frames'] for clip in recipe['clips']] + [1])
    scene.frame_set(0)
    bpy.context.view_layer.update()
    triangles = 0
    graph = bpy.context.evaluated_depsgraph_get()
    for obj in export_objects:
        if obj.type == 'MESH':
            evaluated = obj.evaluated_get(graph)
            mesh = evaluated.to_mesh()
            mesh.calc_loop_triangles()
            triangles += len(mesh.loop_triangles)
            evaluated.to_mesh_clear()
    if triangles > 300000 or len(export_objects) > 1024:
        raise ValueError('Model exceeds the 300000-triangle/1024-object working budget')

    bpy.ops.object.select_all(action='DESELECT')
    for obj in export_objects:
        obj.select_set(True)
    base = recipe['outputBase']
    bpy.ops.export_scene.gltf(filepath=output_path(base, '.glb'), export_format='GLB', use_selection=True, export_yup=True,
        export_apply=True, export_cameras=False, export_lights=False, export_animations=True, export_animation_mode='NLA_TRACKS')

    preview = recipe['preview']
    camera = bpy.data.objects.new('Companion preview camera', bpy.data.cameras.new('Companion preview camera'))
    scene.collection.objects.link(camera)
    camera.location, camera.data.type, camera.data.ortho_scale = preview['position'], 'ORTHO', preview['orthographicScale']
    point_at(camera, preview['target'])
    scene.camera = camera
    for i, item in enumerate(preview['lights']):
        light = bpy.data.objects.new(f'Companion preview light {i}', bpy.data.lights.new(f'Companion preview light {i}', 'AREA'))
        scene.collection.objects.link(light)
        light.location, light.data.energy, light.data.shape, light.data.size = item['position'], item['power'], 'DISK', item['size']
        point_at(light, item['target'])
    scene.world = bpy.data.worlds.new('Companion preview world')
    scene.world.color = color(preview['background'])[:3]
    scene.render.engine = 'CYCLES'
    scene.cycles.device, scene.cycles.samples = 'CPU', preview['samples']
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.film_transparent = preview['transparent']
    scene.render.filepath = output_path(base, '.preview.png')
    bpy.ops.wm.save_as_mainfile(filepath=output_path(base, '.blend'), compress=True, check_existing=False)
    bpy.ops.render.render(write_still=True)
    report = {'schemaVersion': 1, 'blender': bpy.app.version_string, 'triangles': triangles, 'objects': len(export_objects),
        'rigBones': len(recipe.get('rig', {}).get('bones', [])), 'weightedSourceVertices': sum(len(item.get('skin', {}).get('weights', [])) for item in recipe['objects']),
        'clips': [clip['id'] for clip in recipe['clips']], 'units': 'meters', 'recipeAxes': 'Z-up', 'glbAxes': 'Y-up',
        'quality': 'Processed candidate only; artistic, license and gameplay review remain required'}
    Path(output_path(base, '.model.json')).write_text(json.dumps(report, sort_keys=True))
    print('COMPANION_MODEL_PROCESSED', json.dumps(report))


if __name__ == '__main__':
    process()
