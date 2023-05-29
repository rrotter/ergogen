const m = require('makerjs')
const yaml = require('js-yaml')

const u = require('./utils')
const a = require('./assert')
const prep = require('./prepare')
const anchor = require('./anchor').parse
const filter = require('./filter').parse

const kicad_prefix =
`(kicad_pcb (version 20221018) (generator ergogen)

  (general
    (thickness 1.6)
  )

  (paper "A3")
  (title_block
    (title "KEYBOARD_NAME_HERE")
    (rev "VERSION_HERE")
    (company "YOUR_NAME_HERE")
  )

  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (32 "B.Adhes" user "B.Adhesive")
    (33 "F.Adhes" user "F.Adhesive")
    (34 "B.Paste" user)
    (35 "F.Paste" user)
    (36 "B.SilkS" user "B.Silkscreen")
    (37 "F.SilkS" user "F.Silkscreen")
    (38 "B.Mask" user)
    (39 "F.Mask" user)
    (40 "Dwgs.User" user "User.Drawings")
    (41 "Cmts.User" user "User.Comments")
    (42 "Eco1.User" user "User.Eco1")
    (43 "Eco2.User" user "User.Eco2")
    (44 "Edge.Cuts" user)
    (45 "Margin" user)
    (46 "B.CrtYd" user "B.Courtyard")
    (47 "F.CrtYd" user "F.Courtyard")
    (48 "B.Fab" user)
    (49 "F.Fab" user)
  )

  (setup
    (pad_to_mask_clearance 0)
    (pcbplotparams
      (layerselection 0x00010fc_ffffffff)
      (plot_on_all_layers_selection 0x0000000_00000000)
      (disableapertmacros false)
      (usegerberextensions false)
      (usegerberattributes true)
      (usegerberadvancedattributes true)
      (creategerberjobfile true)
      (dashed_line_dash_ratio 12.000000)
      (dashed_line_gap_ratio 3.000000)
      (svgprecision 4)
      (plotframeref false)
      (viasonmask false)
      (mode 1)
      (useauxorigin false)
      (hpglpennumber 1)
      (hpglpenspeed 20)
      (hpglpendiameter 15.000000)
      (dxfpolygonmode true)
      (dxfimperialunits true)
      (dxfusepcbnewfont true)
      (psnegative false)
      (psa4output false)
      (plotreference true)
      (plotvalue true)
      (plotinvisibletext false)
      (sketchpadsonfab false)
      (subtractmaskfromsilk false)
      (outputformat 1)
      (mirror false)
      (drillshape 1)
      (scaleselection 1)
      (outputdirectory "")
    )
  )
`

const kicad_suffix = `
)
`

const makerjs2kicad = exports._makerjs2kicad = (model, layer) => {
    const grs = []
    const xy = val => `${val[0]} ${-val[1]}`
    m.model.walk(model, {
        onPath: wp => {
            const p = wp.pathContext
            switch (p.type) {
                case 'line':
                    grs.push(`(gr_line (start ${xy(p.origin)}) (end ${xy(p.end)}) (stroke (width 0.15) (type solid)) (layer "${layer}"))`)
                    break
                case 'arc':
                    // Normalize angles to the range [0, 360]
                    let startAngle = ((p.startAngle % 360) + 360) % 360;
                    let endAngle = ((p.endAngle % 360) + 360) % 360;

                    // check the case when end angle is smaller than start angle
                    if (endAngle < startAngle) {
                        endAngle += 360;
                    }
                    const start = [p.origin[0] + p.radius * Math.cos(startAngle * (Math.PI / 180)), p.origin[1] + p.radius * Math.sin(startAngle * (Math.PI / 180))]
                    const mid = [p.origin[0] + p.radius * Math.cos(((startAngle + endAngle) * (Math.PI / 180)) / 2), p.origin[1] + p.radius * Math.sin(((startAngle + endAngle) * (Math.PI / 180)) / 2)]
                    const end = [p.origin[0] + p.radius * Math.cos(endAngle * (Math.PI / 180)), p.origin[1] + p.radius * Math.sin(endAngle * (Math.PI / 180))]
                    grs.push(`(gr_arc (start ${xy(start)}) (mid ${xy(mid)}) (end ${xy(end)}) (stroke (width 0.15) (type solid)) (layer "${layer}"))`)
                    break
                case 'circle':
                    const circle_center = p.origin
                    const circle_end = m.point.add(circle_center, [p.radius, 0])
                    grs.push(`(gr_circle (center ${xy(circle_center)}) (end ${xy(circle_end)}) (stroke (width 0.15) (type solid)) (fill none) (layer "${layer}"))`)
                    break
                default:
                    throw new Error(`Can't convert path type "${p.type}" to kicad!`)
            }
        }
    })
    return grs.join('\n  ')
}

const footprint_types = require('./footprints')

exports.inject_footprint = (name, fp) => {
    footprint_types[name] = fp
}

const footprint = exports._footprint = (points, net_indexer, component_indexer, units, extra) => (config, name, point) => {

    // config sanitization
    a.unexpected(config, name, ['what', 'params'])
    const what = a.in(config.what, `${name}.what`, Object.keys(footprint_types))
    const fp = footprint_types[what]
    const original_params = config.params || {}

    // param sanitization
    // we unset the mirror config, as it would be an unexpected field
    let params = u.deepcopy(original_params)
    delete params.mirror
    // but still override with it when applicable
    if (point.meta.mirrored && original_params.mirror !== undefined) {
        const mirror_overrides = a.sane(original_params.mirror, `${name}.params.mirror`, 'object')()
        params = prep.extend(params, mirror_overrides)
    }
    a.unexpected(params, `${name}.params`, Object.keys(fp.params))

    // parsing parameters
    const parsed_params = {}
    for (const [param_name, param_def] of Object.entries(fp.params)) {

        // expand param definition shorthand
        let parsed_def = param_def
        let def_type = a.type(param_def)(units)
        if (def_type == 'string') {
            parsed_def = {type: 'string', value: param_def}
        } else if (def_type == 'number') {
            parsed_def = {type: 'number', value: a.mathnum(param_def)(units)}
        } else if (def_type == 'boolean') {
            parsed_def = {type: 'boolean', value: param_def}
        } else if (def_type == 'array') {
            parsed_def = {type: 'array', value: param_def}
        } else if (def_type == 'object') {
            // parsed param definitions also expand to an object
            // so to detect whether this is an arbitrary object,
            // we first have to make sure it's not an expanded param def
            // (this has to be a heuristic, but should be pretty reliable)
            const defarr = Object.keys(param_def)
            const already_expanded = defarr.length == 2 && defarr.includes('type') && defarr.includes('value')
            if (!already_expanded) {
                parsed_def = {type: 'object', value: param_def}
            }
        } else {
            parsed_def = {type: 'net', value: undefined}
        }

        // combine default value with potential user override
        let value = prep.extend(parsed_def.value, params[param_name])
        let type = parsed_def.type

        // templating support, with conversion back to raw datatypes
        const converters = {
            string: v => v,
            number: v => a.sane(v, `${name}.params.${param_name}`, 'number')(units),
            boolean: v => v === 'true',
            array: v => yaml.load(v),
            object: v => yaml.load(v),
            net: v => v,
            anchor: v => yaml.load(v)
        }
        a.in(type, `${name}.params.${param_name}.type`, Object.keys(converters))
        if (a.type(value)() == 'string') {
            value = u.template(value, point.meta)
            value = converters[type](value)
        }

        // type-specific postprocessing
        if (['string', 'number', 'boolean', 'array', 'object'].includes(type)) {
            parsed_params[param_name] = value
        } else if (type == 'net') {
            const net = a.sane(value, `${name}.params.${param_name}`, 'string')(units)
            const index = net_indexer(net)
            parsed_params[param_name] = {
                name: net,
                index: index,
                str: `(net ${index} "${net}")`
            }
        } else { // anchor
            let parsed_anchor = anchor(value, `${name}.params.${param_name}`, points, point)(units)
            parsed_anchor.y = -parsed_anchor.y // kicad mirror, as per usual
            parsed_params[param_name] = parsed_anchor
        }
    }

    // reference
    const component_ref = parsed_params.ref = component_indexer(parsed_params.designator || '_')
    parsed_params.ref_hide = extra.references ? '' : 'hide'

    // footprint positioning
    parsed_params.at = `(at ${point.x} ${-point.y} ${point.r})`
    parsed_params.rot = point.r
    parsed_params.ixy = (x, y) => {
        const sign = point.meta.mirrored ? -1 : 1
        return `${sign * x} ${y}`
    }
    const xyfunc = (x, y, resist) => {
        const new_anchor = anchor({
            shift: [x, -y],
            resist: resist
        }, '_internal_footprint_xy', points, point)(units)
        return `${new_anchor.x} ${-new_anchor.y}`
    }
    parsed_params.xy = (x, y) => xyfunc(x, y, true)
    parsed_params.sxy = (x, y) => xyfunc(x, y, false)

    // allowing footprints to add dynamic nets
    parsed_params.local_net = suffix => {
        const net = `${component_ref}_${suffix}`
        const index = net_indexer(net)
        return {
            name: net,
            index: index,
            str: `(net ${index} "${net}")`
        }
    }

    return fp.body(parsed_params)
}

exports.parse = (config, points, outlines, units) => {

    const pcbs = a.sane(config.pcbs || {}, 'pcbs', 'object')()
    const results = {}

    for (const [pcb_name, pcb_config] of Object.entries(pcbs)) {

        // config sanitization
        a.unexpected(pcb_config, `pcbs.${pcb_name}`, ['outlines', 'footprints', 'references'])
        const references = a.sane(pcb_config.references || false, `pcbs.${pcb_name}.references`, 'boolean')()

        // outline conversion
        if (a.type(pcb_config.outlines)() == 'array') {
            pcb_config.outlines = {...pcb_config.outlines}
        }
        const config_outlines = a.sane(pcb_config.outlines || {}, `pcbs.${pcb_name}.outlines`, 'object')()
        const kicad_outlines = {}
        for (const [outline_name, outline] of Object.entries(config_outlines)) {
            const ref = a.in(outline.outline, `pcbs.${pcb_name}.outlines.${outline_name}.outline`, Object.keys(outlines))
            const layer = a.sane(outline.layer || 'Edge.Cuts', `pcbs.${pcb_name}.outlines.${outline_name}.outline`, 'string')()
            kicad_outlines[outline_name] = makerjs2kicad(outlines[ref], layer)
        }

        // making a global net index registry
        const nets = {"": 0}
        const net_indexer = net => {
            if (nets[net] !== undefined) return nets[net]
            const index = Object.keys(nets).length
            return nets[net] = index
        }
        // and a component indexer
        const component_registry = {}
        const component_indexer = _class => {
            if (!component_registry[_class]) {
                component_registry[_class] = 0
            }
            component_registry[_class]++
            return `${_class}${component_registry[_class]}`
        }

        const footprints = []
        const footprint_factory = footprint(points, net_indexer, component_indexer, units, {references})

        // generate footprints
        if (a.type(pcb_config.footprints)() == 'array') {
            pcb_config.footprints = {...pcb_config.footprints}
        }
        const footprints_config = a.sane(pcb_config.footprints || {}, `pcbs.${pcb_name}.footprints`, 'object')()
        for (const [f_name, f] of Object.entries(footprints_config)) {
            const name = `pcbs.${pcb_name}.footprints.${f_name}`
            a.sane(f, name, 'object')()
            const asym = a.asym(f.asym || 'source', `${name}.asym`)
            const where = filter(f.where, `${name}.where`, points, units, asym)
            const original_adjust = f.adjust // need to save, so the delete's don't get rid of it below
            const adjust = start => anchor(original_adjust || {}, `${name}.adjust`, points, start)(units)
            delete f.asym
            delete f.where
            delete f.adjust
            for (const w of where) {
                const aw = adjust(w.clone())
                footprints.push(footprint_factory(f, name, aw))
            }
        }

        // finalizing nets
        const nets_arr = []
        const add_nets_arr = []
        for (const [net, index] of Object.entries(nets)) {
            nets_arr.push(`(net ${index} "${net}")`)
            add_nets_arr.push(`(add_net "${net}")`)
        }

        const nets_text = nets_arr.join('\n  ')
        const footprint_text = footprints.join('\n  ')
        const outline_text = Object.values(kicad_outlines).join('\n')
        const personalized_prefix = kicad_prefix
            .replace('KEYBOARD_NAME_HERE', pcb_name)
            .replace('VERSION_HERE', config.meta && config.meta.version || 'v1.0.0')
            .replace('YOUR_NAME_HERE', config.meta && config.meta.author || 'Unknown')
        results[pcb_name] =
`${personalized_prefix}
  ${nets_text}
  ${footprint_text}
  ${outline_text}
${kicad_suffix}`
    }

    return results
}
