const m = require('makerjs')
const u = require('./utils')
const a = require('./assert')

const outline = exports._outline = (points, config={}) => params => {



    const size = a.wh(params.size || [18, 18], '')
    if (!Array.isArray(size)) size = [size, size]
    size = a.xy(size, `outline.exports.${params.name}.size`)
    const corner = params.corner || 0


    let glue = {paths: {}}
    
    if (config.glue) {

        const internal_part = (line) => {
            // taking the middle part only, so that we don't interfere with corner rounding
            return u.line(m.point.middle(line, 0.4), m.point.middle(line, 0.6))
        }

        const get_line = (def={}) => {
            const ref = points[def.ref]
            if (!ref) throw new Error(`Point ${def.ref} not found...`)

            let from = [0, 0]
            let to = [ref.meta.mirrored ? -1 : 1, 0]

            // todo: position according to point to get the lines...

            let point = ref.clone().shift(def.shift || [0, 0])
            point.rotate(def.rotate || 0, point.add(def.origin || [0, 0]))


            const rect = m.model.originate(point.rect(footprint))
            line = rect.paths[def.line || 'top']
            return internal_part(line)
        }

        assert.ok(config.glue.top)
        const tll = get_line(config.glue.top.left)
        const trl = get_line(config.glue.top.right)
        const tip = m.path.converge(tll, trl)
        const tlp = u.eq(tll.origin, tip) ? tll.end : tll.origin
        const trp = u.eq(trl.origin, tip) ? trl.end : trl.origin

        assert.ok(config.glue.bottom)
        const bll = get_line(config.glue.bottom.left)
        const brl = get_line(config.glue.bottom.right)
        const bip = m.path.converge(bll, brl)
        const blp = u.eq(bll.origin, bip) ? bll.end : bll.origin
        const brp = u.eq(brl.origin, bip) ? brl.end : brl.origin

        const left_waypoints = []
        const right_waypoints = []

        for (const w of config.glue.waypoints || []) {
            const percent = w.percent / 100
            const center_x = tip[0] + percent * (bip[0] - tip[0])
            const center_y = tip[1] + percent * (bip[1] - tip[1])
            const left_x = center_x - (w.left || w.width / 2)
            const right_x = center_x + (w.right || w.width / 2)
            left_waypoints.push([left_x, center_y])
            right_waypoints.unshift([right_x, center_y])
        }

        const waypoints =
            [trp, tip, tlp]
            .concat(left_waypoints)
            .concat([blp, bip, brp])
            .concat(right_waypoints)

        glue = u.poly(waypoints)

    }


    let i = 0
    const keys = {}
    let left_keys = {}
    let right_keys = {}
    for (const zone of Object.values(config.zones)) {
        // interate cols in reverse order so they can
        // always overlap with the growing middle patch
        for (const col of zone.columns.slice().reverse()) {
            for (const [pname, p] of Object.entries(points)) {
                if (p.meta.col.name != col.name) continue

                let from_x = -footprint / 2, to_x = footprint / 2
                let from_y = -footprint / 2, to_y = footprint / 2

                let bind = p.meta.bind || 10
                if (!Array.isArray(bind)) {
                    u.assert(u.type(bind) == 'number', `Incorrect "bind" field for point "${p.meta.name}"!`)
                    bind = {top: bind, right: bind, bottom: bind, left: bind}
                } else {
                    u.assert([2, 4].includes(bind.length), `The "bind" field for point "${p.meta.name}" should contain 2 or 4 elements!`)
                    bind.map(val => u.assert(u.type(val) == 'number', `The "bind" field for point "${p.meta.name}" should contain numbers!`))
                }

                const mirrored = p.meta.mirrored
                
                const bind_x = p.meta.row.bind_x || p.meta.col.bind_x
                if ((bind_x == 'left' && !mirrored) || (bind_x == 'right' && mirrored) || bind_x == 'both') {
                    from_x -= bind
                }
                if ((bind_x == 'right' && !mirrored) || (bind_x == 'left' && mirrored) || bind_x == 'both') {
                    to_x += bind
                }

                const bind_y = p.meta.row.bind_y || p.meta.col.bind_y
                if (bind_y == 'down' || bind_y == 'both') {
                    from_y -= bind
                }
                if (bind_y == 'up' || bind_y == 'both') {
                    to_y += bind
                }

                let key = new m.models.RoundRectangle(to_x - from_x, to_y - from_y, corner)
                key = m.model.moveRelative(key, [from_x, from_y])
                key = p.position(key)
                if (mirrored) {
                    right_keys = m.model.combineUnion(right_keys, key)
                } else {
                    left_keys = m.model.combineUnion(left_keys, key)
                }
            }
        }
    }


    u.dump_model({a: glue, b: left_keys, c: {models: right_keys}}, `all_before`)
    glue = m.model.combineUnion(glue, left_keys)
    u.dump_model({a: glue, b: left_keys, c: {models: right_keys}}, `all_after_left`)
    glue = m.model.combineUnion(glue, right_keys)
    u.dump_model({a: glue, b: {models: keys}}, `fullll`)
}









const parse_glue = exports._parse_glue = (config = {}, points = {}) => {

    a.detect_unexpected(config, 'outline.glue', ['top', 'bottom', 'waypoints', 'extra'])

    for (const y in ['top', 'bottom']) {
        a.detect_unexpected(config[y], `outline.glue.${y}`, ['left', 'right'])
        config[y].left = a.anchor(config[y].left, `outline.glue.${y}.left`, points)
        if (a.type(config[y].right) != 'number') {
            config[y].right = a.anchor(config[y].right, `outline.glue.${y}.right`, points)
        }
    }

    config.waypoints = a.sane(config.waypoints || [], 'outline.glue.waypoints', 'array')
    let wi = 0
    config.waypoints = config.waypoints.map(w => {
        const name = `outline.glue.waypoints[${++wi}]`
        a.detect_unexpected(w, name, ['percent', 'width'])
        w.percent = a.sane(w.percent, name + '.percent', 'number')
        w.width = a.wh(w.width, name + '.width')
        return w
    })

    // TODO: handle glue.extra (or revoke it from the docs)

    return (export_name, params) => {

        a.detect_unexpected(params, `outline.exports.${export_name}`, ['side', 'size', 'corner', 'bevel'])
        params.side = a.in(params.side, `outline.exports.${export_name}.side`, ['left', 'right', 'both', 'glue', 'raw'])
        params.size = a.wh(params.size, `outline.exports.${export_name}.size`)
        params.corner = a.sane(params.corner || 0, `outline.exports.${export_name}.corner`, 'number')
        params.bevel = a.sane(params.bevel || 0, `outline.exports.${export_name}.bevel`, 'number')

        let glue
        if (['both', 'glue', 'raw'].includes(params.side)) {

            const get_line = (anchor) => {
                if (a.type(anchor) == 'number') {
                    return u.line([anchor, -1000], [anchor, 1000])
                }
    
                let from = anchor.clone()
                let to = anchor.add([anchor.meta.mirrored ? -1 : 1, 0])
                to = to.rotate(anchor.r, anchor.p).p

                return u.line(from, to)
            }
    
            const tll = get_line(config.top.left)
            const trl = get_line(config.top.right)
            const tip = m.path.converge(tll, trl)
            const tlp = u.eq(tll.origin, tip) ? tll.end : tll.origin
            const trp = u.eq(trl.origin, tip) ? trl.end : trl.origin
    
            const bll = get_line(config.bottom.left)
            const brl = get_line(config.bottom.right)
            const bip = m.path.converge(bll, brl)
            const blp = u.eq(bll.origin, bip) ? bll.end : bll.origin
            const brp = u.eq(brl.origin, bip) ? brl.end : brl.origin
    
            const left_waypoints = []
            const right_waypoints = []
    
            for (const w of config.waypoints) {
                const percent = w.percent / 100
                const center_x = tip[0] + percent * (bip[0] - tip[0])
                const center_y = tip[1] + percent * (bip[1] - tip[1])
                const left_x = center_x - (w.left || w.width / 2)
                const right_x = center_x + (w.right || w.width / 2)
                left_waypoints.push([left_x, center_y])
                right_waypoints.unshift([right_x, center_y])
            }
            
            let waypoints
            const is_split = a.type(config.top.right) == 'number'
            if (is_split) {
                waypoints = [tip, tlp]
                .concat(left_waypoints)
                .concat([blp, bip])
            } else {
                waypoints = [trp, tip, tlp]
                .concat(left_waypoints)
                .concat([blp, bip, brp])
                .concat(right_waypoints)
            }
    
            glue = u.poly(waypoints)
        }
        
    }
}



const parse_exports = exports._parse_exports = (config = {}, points = {}) => {

    config = a.sane(config, 'outline.exports', 'object')
    for (const [key, val] of Object.entries(config)) {
        params.op = a.in(params.op || 'add', `outline.exports.${key}.op`, ['add', 'sub', 'diff'])
        params.type = a.in(params.type, `outline.exports.${key}.type`, ['add', 'sub', 'diff'])
    }
}

exports.parse = (config = {}, points = {}) => {
    a.detect_unexpected(config, 'outline', ['glue', 'exports'])
    const glue = parse_glue(config.glue, points)

    config = a.sane(config, 'outline.exports', 'object')
    for (const [key, val] of Object.entries(config)) {
        params.op = a.in(params.op || 'add', `outline.exports.${key}.op`, ['add', 'sub', 'diff'])
        params.type = a.in(params.type, `outline.exports.${key}.type`, ['add', 'sub', 'diff'])
    }
}